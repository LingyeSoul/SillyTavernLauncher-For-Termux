#!/usr/bin/env python3
"""传统 ``st`` CLI 使用的认证、事务式数据同步客户端。"""

import argparse
import hashlib
import os
import shutil
import stat
import tempfile
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlsplit, urlunsplit

import requests

from sync_server import build_manifest
from utils.sync_common import (
    MAX_SYNC_ZIP_FILES,
    MAX_SYNC_ZIP_SIZE,
    SyncNetworkError,
    SyncSecurityError,
    SyncUsageError,
    find_data_path,
    safe_relative_path,
)


def parse_share_url(share_url):
    """拆分分享 URL，并保证令牌只存在于不会发送给服务器的 fragment。"""
    if not isinstance(share_url, str):
        raise SyncUsageError("同步服务器地址无效")
    try:
        parsed = urlsplit(share_url.strip())
        port = parsed.port
    except ValueError as error:
        raise SyncUsageError("同步服务器地址无效") from error

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise SyncUsageError("同步服务器必须是有效的 HTTP(S) 分享地址")

    fragment = parse_qs(parsed.fragment, keep_blank_values=True)
    tokens = fragment.get("token", [])
    if set(fragment) != {"token"} or len(tokens) != 1 or not tokens[0]:
        raise SyncUsageError("同步分享地址缺少有效的 token fragment")

    base_url = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "")
    )
    return base_url, tokens[0]


def _safe_relative_path(base, relative_path):
    """保留传统模块的私有入口，统一使用共享路径校验。"""
    return safe_relative_path(Path(base), relative_path)


def _validated_zip_members(archive, destination):
    infos = archive.infolist()
    if len(infos) > MAX_SYNC_ZIP_FILES:
        raise SyncSecurityError("ZIP 文件数量超过限制")
    if sum(info.file_size for info in infos) > MAX_SYNC_ZIP_SIZE:
        raise SyncSecurityError("ZIP 解压后大小超过限制")

    normalized_entries = []
    seen = set()
    files = set()
    for info in infos:
        name = info.filename
        if not name or "\x00" in name or "\\" in name:
            raise SyncSecurityError("ZIP 包含无效路径")
        pure_path = PurePosixPath(name.rstrip("/"))
        if (
            not pure_path.parts
            or pure_path.is_absolute()
            or ".." in pure_path.parts
            or pure_path.parts[0].endswith(":")
        ):
            raise SyncSecurityError("ZIP 路径越过数据目录")

        normalized = pure_path.as_posix()
        if normalized in seen:
            raise SyncSecurityError("ZIP 包含重复路径")
        seen.add(normalized)

        mode = info.external_attr >> 16
        if mode and stat.S_ISLNK(mode):
            raise SyncSecurityError("ZIP 不允许包含符号链接")
        if info.flag_bits & 0x1:
            raise SyncSecurityError("ZIP 不允许包含加密文件")

        for parent in pure_path.parents:
            if parent != PurePosixPath(".") and parent.as_posix() in files:
                raise SyncSecurityError("ZIP 文件与目录路径冲突")
        if not info.is_dir():
            files.add(normalized)

        target = _safe_relative_path(destination, normalized)
        normalized_entries.append((info, target))
    for file_path in files:
        if any(
            entry != file_path and entry.startswith(f"{file_path}/")
            for entry in seen
        ):
            raise SyncSecurityError("ZIP 文件与目录路径冲突")
    return normalized_entries


def _extract_validated_zip(archive, destination):
    for info, target in _validated_zip_members(archive, destination):
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with archive.open(info, "r") as source, target.open("xb") as output:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > info.file_size:
                    raise SyncSecurityError("ZIP 文件大小与声明不一致")
                output.write(chunk)
        if written != info.file_size:
            raise SyncSecurityError("ZIP 文件大小与声明不一致")


class SyncClient:
    def __init__(self, server_url, data_path=None, timeout=30):
        self.server_url, token = parse_share_url(server_url)
        selected_data_path = data_path or find_data_path(
            extra_paths=["./backup/default-user"], match_parent=True
        )
        self.data_path = Path(selected_data_path).expanduser().resolve()
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}"})

        print("数据同步客户端已初始化")
        print(f"服务器地址: {self.server_url}")
        print(f"本地数据路径: {self.data_path}")

    def _request(self, endpoint, params=None, stream=False):
        url = f"{self.server_url}/{endpoint.lstrip('/')}"
        try:
            response = self.session.get(
                url,
                params=params,
                timeout=self.timeout,
                stream=stream,
            )
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            raise SyncNetworkError(f"同步请求失败 ({endpoint}): {error}") from error

    def health(self):
        url = f"{self.server_url}/health"
        try:
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as error:
            raise SyncNetworkError(f"同步服务器健康检查失败: {error}") from error
        if payload.get("status") != "healthy":
            raise SyncNetworkError("同步服务器状态异常")
        return payload

    def check_server_health(self):
        try:
            self.health()
            print("服务器状态: 健康")
            return True
        except SyncNetworkError as error:
            print(f"服务器健康检查失败: {error}")
            return False

    def info(self):
        try:
            payload = self._request("info").json()
        except ValueError as error:
            raise SyncNetworkError("同步服务器返回了无效 JSON") from error
        if not isinstance(payload, dict) or not payload.get("success"):
            raise SyncNetworkError("同步服务器返回了无效信息")
        return payload

    def get_server_info(self):
        try:
            return self.info()
        except SyncNetworkError as error:
            print(f"获取服务器信息失败: {error}")
            return None

    def _remote_manifest(self):
        try:
            payload = self._request("manifest").json()
            manifest = payload.get("manifest", payload.get("files"))
        except (ValueError, AttributeError) as error:
            raise SyncNetworkError("同步服务器返回了无效文件清单") from error
        if not isinstance(manifest, list):
            raise SyncNetworkError("同步服务器返回了无效文件清单")

        normalized = []
        seen = set()
        for item in manifest:
            if not isinstance(item, dict):
                raise SyncNetworkError("文件清单条目格式无效")
            relative_path = item.get("path")
            _safe_relative_path(self.data_path, relative_path)
            if relative_path in seen:
                raise SyncSecurityError("文件清单包含重复路径")
            seen.add(relative_path)

            size = item.get("size")
            digest = item.get("sha256")
            if (
                isinstance(size, bool)
                or not isinstance(size, int)
                or size < 0
                or not isinstance(digest, str)
                or len(digest) != 64
                or any(character not in "0123456789abcdefABCDEF" for character in digest)
            ):
                raise SyncNetworkError("文件清单元数据无效")
            mtime = item.get("mtime")
            if mtime is not None and (
                isinstance(mtime, bool) or not isinstance(mtime, (int, float))
            ):
                raise SyncNetworkError("文件清单时间戳无效")
            normalized.append(item)
        for relative_path in seen:
            parents = PurePosixPath(relative_path).parents
            if any(
                parent != PurePosixPath(".") and parent.as_posix() in seen
                for parent in parents
            ):
                raise SyncSecurityError("文件清单包含文件与目录路径冲突")
        return normalized

    def get_remote_manifest(self):
        try:
            return self._remote_manifest()
        except (SyncNetworkError, SyncSecurityError) as error:
            print(f"获取远程文件清单失败: {error}")
            return None

    def get_local_manifest(self):
        return build_manifest(self.data_path) if self.data_path.exists() else []

    def _backup(self):
        if not self.data_path.exists():
            return None
        backup_root = self.data_path.parent / ".stl-backups"
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = backup_root / (
            f"{self.data_path.name}.{time.strftime('%Y%m%d-%H%M%S')}"
        )
        suffix = 0
        while backup.exists():
            suffix += 1
            backup = backup.with_name(f"{backup.name}.{suffix}")
        shutil.copytree(self.data_path, backup, symlinks=True)
        return backup

    def _replace_data(self, source, backup):
        self.data_path.parent.mkdir(parents=True, exist_ok=True)
        rollback = self.data_path.parent / (
            f".{self.data_path.name}.rollback-{uuid.uuid4().hex}"
        )
        had_existing = self.data_path.exists()
        try:
            if had_existing:
                os.replace(str(self.data_path), str(rollback))
            os.replace(str(source), str(self.data_path))
            if rollback.exists():
                shutil.rmtree(rollback)
        except OSError as error:
            if self.data_path.exists():
                shutil.rmtree(self.data_path)
            if rollback.exists():
                os.replace(str(rollback), str(self.data_path))
            elif backup and backup.exists():
                shutil.copytree(backup, self.data_path, symlinks=True)
            raise SyncUsageError(f"替换同步数据失败: {error}") from error

    def sync_full_zip(self, backup=True):
        print("开始 ZIP 全量同步...")
        self.data_path.parent.mkdir(parents=True, exist_ok=True)
        saved_backup = self._backup() if backup else None
        downloaded = 0

        with tempfile.TemporaryDirectory(
            prefix=".stl-sync-", dir=str(self.data_path.parent)
        ) as temp_name:
            temp = Path(temp_name)
            archive_path = temp / "download.zip"
            payload = temp / "payload"
            payload.mkdir()
            response = self._request("zip", stream=True)
            try:
                with archive_path.open("wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if not chunk:
                            continue
                        downloaded += len(chunk)
                        if downloaded > MAX_SYNC_ZIP_SIZE:
                            raise SyncSecurityError("下载的 ZIP 超过大小限制")
                        output.write(chunk)
            finally:
                response.close()

            if not zipfile.is_zipfile(archive_path):
                raise SyncSecurityError("同步服务器返回的内容不是有效 ZIP")
            with zipfile.ZipFile(archive_path, "r") as archive:
                _extract_validated_zip(archive, payload)
            self._replace_data(payload, saved_backup)

        print("ZIP 全量同步完成")
        return {
            "method": "zip",
            "bytes_downloaded": downloaded,
            "backup": str(saved_backup) if saved_backup else None,
        }

    def sync_incremental(self, backup=True):
        print("开始增量同步...")
        remote = self._remote_manifest()
        remote_by_path = {item["path"]: item for item in remote}
        local = self.get_local_manifest()
        local_by_path = {item["path"]: item for item in local}

        downloads = [
            item
            for relative_path, item in remote_by_path.items()
            if relative_path not in local_by_path
            or item["sha256"].lower()
            != local_by_path[relative_path]["sha256"].lower()
        ]
        deletes = [
            relative_path
            for relative_path in local_by_path
            if relative_path not in remote_by_path
        ]
        saved_backup = self._backup() if backup and (downloads or deletes) else None
        self.data_path.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory(
            prefix=".stl-download-", dir=str(self.data_path.parent)
        ) as temp_name:
            temp = Path(temp_name)
            for item in downloads:
                relative_path = item["path"]
                output_path = _safe_relative_path(temp, relative_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)
                response = self._request(
                    "file", params={"path": relative_path}, stream=True
                )
                digest = hashlib.sha256()
                downloaded_size = 0
                try:
                    with output_path.open("xb") as output:
                        for chunk in response.iter_content(chunk_size=1024 * 1024):
                            if not chunk:
                                continue
                            downloaded_size += len(chunk)
                            if downloaded_size > item["size"]:
                                raise SyncSecurityError(
                                    "下载文件超过清单声明大小"
                                )
                            digest.update(chunk)
                            output.write(chunk)
                finally:
                    response.close()
                if (
                    downloaded_size != item["size"]
                    or digest.hexdigest().lower() != item["sha256"].lower()
                ):
                    raise SyncSecurityError("下载文件完整性校验失败")

            try:
                for item in downloads:
                    relative_path = item["path"]
                    source = _safe_relative_path(temp, relative_path)
                    target = _safe_relative_path(self.data_path, relative_path)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(str(source), str(target))
                    mtime = item.get("mtime")
                    if isinstance(mtime, (int, float)) and not isinstance(mtime, bool):
                        os.utime(target, (mtime, mtime))
                for relative_path in deletes:
                    target = _safe_relative_path(self.data_path, relative_path)
                    if target.is_symlink():
                        raise SyncSecurityError("拒绝删除符号链接")
                    target.unlink(missing_ok=True)
            except (OSError, SyncSecurityError) as error:
                if saved_backup and saved_backup.exists():
                    if self.data_path.exists():
                        shutil.rmtree(self.data_path)
                    shutil.copytree(saved_backup, self.data_path, symlinks=True)
                raise SyncUsageError(f"增量同步失败: {error}") from error

        print(
            f"增量同步完成：下载 {len(downloads)} 个文件，删除 {len(deletes)} 个文件"
        )
        return {
            "method": "incremental",
            "downloaded_files": len(downloads),
            "deleted_files": len(deletes),
            "backup": str(saved_backup) if saved_backup else None,
        }

    def sync(self, method="auto", backup=True, prefer_zip=None):
        if prefer_zip is not None:
            method = "auto" if prefer_zip else "incremental"
        self.health()
        if method == "zip":
            return self.sync_full_zip(backup=backup)
        if method == "incremental":
            return self.sync_incremental(backup=backup)
        if method != "auto":
            raise SyncUsageError("同步方式必须是 auto、zip 或 incremental")

        try:
            return self.sync_full_zip(backup=backup)
        except SyncNetworkError:
            print("ZIP 下载发生网络错误，改用增量同步...")
            return self.sync_incremental(backup=backup)


def main():
    parser = argparse.ArgumentParser(description="SillyTavern 数据同步客户端")
    parser.add_argument("server_url", help="服务器分享地址（包含 #token=...）")
    parser.add_argument("--data-path", "-d", help="本地数据目录路径")
    parser.add_argument(
        "--method",
        "-m",
        choices=["zip", "incremental", "auto"],
        default="auto",
        help="同步方法",
    )
    parser.add_argument("--no-backup", action="store_true", help="不备份现有数据")
    parser.add_argument("--timeout", "-t", type=int, default=30, help="请求超时秒数")
    args = parser.parse_args()

    try:
        client = SyncClient(args.server_url, args.data_path, args.timeout)
        result = client.sync(args.method, backup=not args.no_backup)
        print(f"同步完成: {result}")
        return 0
    except Exception as error:
        print(f"同步失败: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
