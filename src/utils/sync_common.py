"""
同步模块公共工具
"""

import json
import os
import signal
import time
from pathlib import Path, PurePosixPath
from urllib.parse import quote, urlsplit, urlunsplit


MAX_SYNC_ZIP_FILES = 20_000
MAX_SYNC_ZIP_SIZE = 2 * 1024 ** 3
# 经过令牌认证的局域网同步需要监听全部网络接口。
ALL_INTERFACES = "0.0.0.0"  # nosec B104


class SyncError(Exception):
    """同步操作基础异常。"""


class SyncUsageError(SyncError):
    """同步参数或运行环境无效。"""


class SyncNetworkError(SyncError):
    """同步网络请求失败。"""


class SyncSecurityError(SyncError):
    """同步内容或路径未通过安全校验。"""


def build_share_url(host, port, token):
    """构造令牌只位于 fragment 的同步分享地址。"""
    display_host = f"[{host}]" if ":" in host and not host.startswith("[") else host
    return f"http://{display_host}:{port}#token={quote(token, safe='')}"


def redact_share_url(share_url):
    """隐藏分享地址中的令牌，供普通状态与错误日志使用。"""
    try:
        parsed = urlsplit(share_url)
    except (TypeError, ValueError):
        return "<无效同步地址>"
    query = "<hidden>" if parsed.query else ""
    fragment = "token=<hidden>" if parsed.fragment else ""
    return urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, query, fragment)
    )


def write_pid_record(path, pid, executable, command_marker):
    """原子写入同步服务器进程记录。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    record = {
        "pid": pid,
        "executable": str(Path(executable).resolve()),
        "command": str(Path(command_marker).resolve()),
        "started": time.time(),
    }
    try:
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(record, file)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temp_path, 0o600)
        os.replace(str(temp_path), str(path))
        os.chmod(path, 0o600)
    except OSError:
        temp_path.unlink(missing_ok=True)
        raise


def _verified_pid_record(path, expected_executable, expected_command):
    try:
        record = json.loads(Path(path).read_text(encoding="utf-8"))
        pid = int(record["pid"])
        executable = Path(record["executable"])
        command = Path(record["command"])
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        raise SyncSecurityError("同步服务器进程记录无效") from error

    if (
        pid <= 1
        or executable.name != Path(expected_executable).name
        or command.resolve() != Path(expected_command).resolve()
    ):
        raise SyncSecurityError("同步服务器进程记录与当前启动器不匹配")

    proc_cmdline = Path("/proc") / str(pid) / "cmdline"
    if proc_cmdline.exists():
        try:
            command_parts = [
                part.decode(errors="replace")
                for part in proc_cmdline.read_bytes().split(b"\0")
                if part
            ]
            process_cwd = (Path("/proc") / str(pid) / "cwd").resolve()
        except OSError as error:
            raise SyncSecurityError("无法验证同步服务器进程") from error
        executable_matches = any(
            Path(part).name == executable.name for part in command_parts
        )
        command_matches = False
        for part in command_parts:
            candidate = Path(part)
            if candidate.suffix != ".py":
                continue
            if not candidate.is_absolute():
                candidate = process_cwd / candidate
            try:
                if candidate.resolve() == command:
                    command_matches = True
                    break
            except OSError:
                continue
        if not executable_matches or not command_matches:
            raise SyncSecurityError("记录的 PID 属于其他进程")
    return pid


def recorded_process_is_running(path, expected_executable, expected_command):
    """安全检查进程记录指向的同步服务器是否仍在运行。"""
    pid = _verified_pid_record(path, expected_executable, expected_command)
    if pid is None:
        return False
    proc_path = Path("/proc") / str(pid)
    if Path("/proc").exists():
        if proc_path.exists():
            return True
        Path(path).unlink(missing_ok=True)
        return False
    return False


def stop_recorded_process(path, expected_executable, expected_command):
    """验证进程身份后停止另一个终端中的同步服务器。"""
    pid = _verified_pid_record(path, expected_executable, expected_command)
    if pid is None:
        return False
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        Path(path).unlink(missing_ok=True)
        return False
    except OSError as error:
        raise SyncUsageError(f"停止同步服务器失败: {error}") from error
    Path(path).unlink(missing_ok=True)
    return True


def format_size(size_bytes):
    """格式化文件大小为人类可读格式"""
    if size_bytes == 0:
        return "0B"

    size_names = ["B", "KB", "MB", "GB"]
    i = 0
    while size_bytes >= 1024 and i < len(size_names) - 1:
        size_bytes /= 1024.0
        i += 1

    return f"{size_bytes:.1f}{size_names[i]}"


def find_data_path(extra_paths=None, match_parent=False):
    """自动检测 SillyTavern 数据目录

    Args:
        extra_paths: 额外的候选路径列表
        match_parent: 是否匹配父目录存在（而非路径本身）

    Returns:
        检测到的数据路径
    """
    possible_paths = [
        os.path.join(os.getcwd(), "SillyTavern", "data", "default-user"),
        os.path.join(os.getcwd(), "data", "default-user"),
        os.path.expanduser("~/SillyTavern/data/default-user"),
        "./SillyTavern/data/default-user",
    ]

    if extra_paths:
        possible_paths.extend(extra_paths)

    for path in possible_paths:
        if match_parent:
            if os.path.exists(path) or os.path.exists(os.path.dirname(path)):
                print(f"检测到数据目录: {path}")
                return path
        else:
            if os.path.exists(path):
                print(f"检测到数据目录: {path}")
                return path

    default_path = os.path.join(os.getcwd(), "SillyTavern", "data", "default-user")
    print(f"未找到数据目录，使用默认路径: {default_path}")
    return default_path


def validate_safe_path(base_path, user_path):
    """校验用户路径是否在基础路径内，防止路径穿越

    Args:
        base_path: 允许的基础目录
        user_path: 用户提供的相对路径

    Returns:
        安全的完整路径，如果不安全则返回 None
    """
    try:
        return str(safe_relative_path(Path(base_path), user_path))
    except SyncSecurityError:
        return None


def safe_relative_path(base_path, relative_path):
    """将 POSIX 相对路径安全映射到基础目录，拒绝穿越和符号链接。"""
    if (
        not isinstance(relative_path, str)
        or not relative_path
        or "\x00" in relative_path
        or "\\" in relative_path
    ):
        raise SyncSecurityError("无效的同步文件路径")

    pure_path = PurePosixPath(relative_path)
    if (
        pure_path.is_absolute()
        or ".." in pure_path.parts
        or not pure_path.parts
        or pure_path.parts[0].endswith(":")
    ):
        raise SyncSecurityError("同步文件路径越过数据目录")

    base = Path(base_path).expanduser().resolve()
    candidate = base
    for part in pure_path.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise SyncSecurityError("同步文件路径包含符号链接")

    target = candidate.resolve()
    try:
        inside = os.path.commonpath((str(base), str(target))) == str(base)
    except ValueError:
        inside = False
    if not inside or target == base:
        raise SyncSecurityError("同步文件路径越过数据目录")
    return target
