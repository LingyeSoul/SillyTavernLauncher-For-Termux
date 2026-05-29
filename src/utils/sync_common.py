"""
同步模块公共工具
"""

import os


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
    base = os.path.realpath(base_path)
    full_path = os.path.realpath(os.path.join(base, user_path))
    if not full_path.startswith(base + os.sep) and full_path != base:
        return None
    return full_path
