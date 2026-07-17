#!/usr/bin/env python3
"""带认证的数据同步服务器，供传统 ``st`` CLI 使用。"""

import argparse
import hashlib
import hmac
import logging
import os
import secrets
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException
from werkzeug.serving import make_server

from utils.sync_common import (
    ALL_INTERFACES,
    SyncSecurityError,
    SyncUsageError,
    build_share_url,
    find_data_path,
    safe_relative_path,
)


LOGGER = logging.getLogger("sillytavern_launcher.sync_server")


def safe_data_file(base_dir, relative_path):
    """解析一个可下载文件，拒绝目录穿越、目录本身和符号链接。"""
    target = safe_relative_path(Path(base_dir), relative_path)
    if not target.is_file():
        raise SyncUsageError("文件不存在")
    return target


def iter_data_files(base_dir):
    """遍历数据目录内的普通文件，不跟随任何符号链接。"""
    base = Path(base_dir).expanduser().resolve()
    if not base.is_dir():
        return

    for root, dirs, files in os.walk(str(base), followlinks=False):
        root_path = Path(root)
        dirs[:] = [name for name in dirs if not (root_path / name).is_symlink()]
        for name in files:
            raw_path = root_path / name
            if raw_path.is_symlink():
                continue
            target = raw_path.resolve()
            try:
                inside = os.path.commonpath((str(base), str(target))) == str(base)
            except ValueError:
                inside = False
            if inside and target.is_file():
                yield target, target.relative_to(base).as_posix()


def build_manifest(base_dir):
    """生成带 SHA-256 的稳定文件清单。"""
    manifest = []
    for path, relative_path in iter_data_files(base_dir):
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        stat_result = path.stat()
        manifest.append(
            {
                "path": relative_path,
                "size": stat_result.st_size,
                "mtime": stat_result.st_mtime,
                "modified": datetime.fromtimestamp(
                    stat_result.st_mtime, timezone.utc
                ).isoformat(),
                "is_dir": False,
                "sha256": digest.hexdigest(),
            }
        )
    return sorted(manifest, key=lambda item: item["path"])


def create_sync_app(data_dir, token_provider, server_info_provider=None):
    """创建同步 Flask 应用；除健康检查外，所有接口均要求 Bearer Token。"""
    data_dir = Path(data_dir).expanduser().resolve()
    app = Flask(__name__)

    @app.before_request
    def require_authentication():
        if request.path == "/health":
            return None

        authorization = request.headers.get("Authorization", "")
        scheme, separator, provided_token = authorization.partition(" ")
        try:
            expected_token = token_provider()
        except Exception:
            LOGGER.exception("读取同步认证状态失败")
            return jsonify(success=False, error="认证状态不可用"), 503

        if not isinstance(expected_token, str) or not expected_token:
            LOGGER.error("同步认证令牌为空")
            return jsonify(success=False, error="认证状态不可用"), 503
        if (
            separator != " "
            or scheme.lower() != "bearer"
            or not provided_token
            or not hmac.compare_digest(provided_token, expected_token)
        ):
            return jsonify(success=False, error="需要有效的同步认证令牌"), 401
        return None

    @app.after_request
    def add_security_headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.errorhandler(SyncSecurityError)
    def handle_security_error(error):
        return jsonify(success=False, error=str(error)), 403

    @app.errorhandler(SyncUsageError)
    def handle_usage_error(error):
        return jsonify(success=False, error=str(error)), 404

    @app.errorhandler(Exception)
    def handle_unexpected_error(error):
        if isinstance(error, HTTPException):
            return error
        LOGGER.exception("同步服务器处理请求失败")
        return jsonify(success=False, error="服务器内部错误"), 500

    @app.get("/health")
    def health_check():
        return jsonify(
            status="healthy",
            timestamp=datetime.now(timezone.utc).isoformat(),
            auth_required=True,
        )

    @app.get("/manifest")
    def get_manifest():
        manifest = build_manifest(data_dir)
        return jsonify(
            success=True,
            manifest=manifest,
            total_files=len(manifest),
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    @app.get("/zip")
    def get_zip():
        descriptor, temp_name = tempfile.mkstemp(prefix="stl-sync-", suffix=".zip")
        os.close(descriptor)
        try:
            with zipfile.ZipFile(
                temp_name, "w", compression=zipfile.ZIP_DEFLATED
            ) as archive:
                for path, relative_path in iter_data_files(data_dir):
                    archive.write(str(path), relative_path)
            response = send_file(
                temp_name,
                mimetype="application/zip",
                as_attachment=True,
                download_name="sillytavern-data.zip",
            )
            response.call_on_close(lambda: Path(temp_name).unlink(missing_ok=True))
            return response
        except Exception:
            Path(temp_name).unlink(missing_ok=True)
            raise

    @app.get("/file")
    def get_file():
        relative_path = request.args.get("path", "")
        if not relative_path:
            return jsonify(success=False, error="缺少 path 参数"), 400
        path = safe_data_file(data_dir, relative_path)
        return send_file(str(path), as_attachment=True, download_name=path.name)

    @app.get("/info")
    def get_info():
        manifest = build_manifest(data_dir)
        server_info = {
            "total_size": sum(item["size"] for item in manifest),
            "file_count": len(manifest),
            "auth_required": True,
        }
        if server_info_provider is not None:
            public_info = server_info_provider()
            if isinstance(public_info, dict):
                for key in ("host", "port", "running"):
                    if key in public_info:
                        server_info[key] = public_info[key]
        return jsonify(success=True, server_info=server_info)

    return app


class SyncServer:
    """传统 CLI 使用的可阻塞或后台运行同步服务器。"""

    def __init__(
        self,
        data_path=None,
        port=9999,
        host=ALL_INTERFACES,
        token_provider=None,
    ):
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise SyncUsageError("同步端口必须在 1-65535 范围内")

        self.port = port
        self.host = host
        self.data_path = Path(data_path or find_data_path()).expanduser().resolve()
        if not self.data_path.is_dir():
            raise SyncUsageError(f"数据目录不存在: {self.data_path}")

        self._fallback_token = secrets.token_urlsafe(24)
        self.token_provider = token_provider or (lambda: self._fallback_token)
        self.running = False
        self.server_thread = None
        self.app = create_sync_app(
            self.data_path,
            self.token_provider,
            lambda: {
                "host": self.host,
                "port": self.port,
                "running": self.running,
            },
        )
        try:
            self._server = make_server(self.host, self.port, self.app, threaded=True)
        except OSError as error:
            raise SyncUsageError(f"无法监听同步端口: {error}") from error

        print("数据同步服务已初始化")
        print(f"数据路径: {self.data_path}")
        print(f"监听地址: {self.host}:{self.port}")

    def share_url(self, public_host=None):
        """生成令牌位于 fragment 中的分享 URL，令牌不会进入 HTTP 日志。"""
        host = public_host or self.host
        return build_share_url(host, self.port, self.token_provider())

    def start(self, block=False):
        if self.running:
            print("数据同步服务已在运行")
            return True

        self.running = True
        if block:
            try:
                self._server.serve_forever()
            finally:
                self.running = False
                self._server.server_close()
            return True

        def run_server():
            try:
                self._server.serve_forever()
            finally:
                self.running = False
                self._server.server_close()

        self.server_thread = threading.Thread(target=run_server, daemon=True)
        self.server_thread.start()
        print(f"数据同步服务已在后台启动: {self.host}:{self.port}")
        return True

    def stop(self):
        if self.running:
            self._server.shutdown()
            if self.server_thread and self.server_thread is not threading.current_thread():
                self.server_thread.join(timeout=5)
            self.running = False
            print("数据同步服务已停止")
        else:
            self._server.server_close()
        return True


def main():
    parser = argparse.ArgumentParser(description="SillyTavern 数据同步服务器")
    parser.add_argument("--data-path", "-d", help="SillyTavern 数据目录路径")
    parser.add_argument("--port", "-p", type=int, default=9999, help="服务器端口")
    parser.add_argument("--host", default=ALL_INTERFACES, help="服务器监听地址")
    parser.add_argument("--block", action="store_true", help="阻塞运行")
    args = parser.parse_args()

    try:
        server = SyncServer(args.data_path or find_data_path(), args.port, args.host)
        public_host = "127.0.0.1" if args.host == ALL_INTERFACES else args.host
        print(f"分享地址: {server.share_url(public_host)}")
        server.start(block=args.block)
        if not args.block:
            print("按 Ctrl+C 停止服务...")
            while server.running:
                time.sleep(1)
    except KeyboardInterrupt:
        if "server" in locals():
            server.stop()
        return 0
    except Exception as error:
        print(f"启动服务器失败: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
