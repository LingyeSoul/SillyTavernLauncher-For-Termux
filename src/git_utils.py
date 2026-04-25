"""
Termux版本的Git工具函数
用于SillyTavern版本切换
"""

import os
import subprocess


def checkout_st_version(commit_hash, st_dir=None):
    """
    切换SillyTavern到指定commit（保持在release分支上，避免detached HEAD）

    Args:
        commit_hash (str): 目标commit的完整hash或前7位
        st_dir (str): SillyTavern目录路径，默认为当前目录下的SillyTavern文件夹

    Returns:
        tuple: (success: bool, message: str)
    """
    if st_dir is None:
        st_dir = os.path.join(os.getcwd(), "SillyTavern")

    # 检查目录是否存在
    if not os.path.exists(st_dir):
        return False, "SillyTavern目录不存在"

    # 检查是否是Git仓库
    git_dir = os.path.join(st_dir, ".git")
    if not os.path.exists(git_dir):
        return False, "SillyTavern目录不是Git仓库"

    try:
        # 步骤1：检查当前分支状态
        check_branch = subprocess.run(
            "git rev-parse --abbrev-ref HEAD",
            shell=True,
            capture_output=True,
            text=True,
            cwd=st_dir,
        )

        current_branch = (
            check_branch.stdout.strip() if check_branch.returncode == 0 else ""
        )

        # 步骤2：如果是detached HEAD状态，先切换回release分支
        if current_branch == "HEAD":
            print("检测到detached HEAD状态，切换回release分支...")

            # 尝试切换到release分支
            checkout_release = subprocess.run(
                "git checkout release",
                shell=True,
                capture_output=True,
                text=True,
                cwd=st_dir,
            )

            if checkout_release.returncode != 0:
                # 如果本地没有release分支，从远程创建
                print("本地没有release分支，从远程创建...")
                checkout_release = subprocess.run(
                    "git checkout -b release origin/release",
                    shell=True,
                    capture_output=True,
                    text=True,
                    cwd=st_dir,
                )

                if checkout_release.returncode != 0:
                    return (
                        False,
                        f"无法切换到release分支: {checkout_release.stderr.strip() if checkout_release.stderr else '未知错误'}",
                    )

        # 步骤3：确保在release分支上（如果当前在其他分支，切换到release）
        if current_branch != "release":
            print(f"当前在 {current_branch} 分支，切换到release分支...")

            checkout_release = subprocess.run(
                "git checkout release",
                shell=True,
                capture_output=True,
                text=True,
                cwd=st_dir,
            )

            if checkout_release.returncode != 0:
                return (
                    False,
                    f"切换到release分支失败: {checkout_release.stderr.strip() if checkout_release.stderr else '未知错误'}",
                )

        # 步骤4：检查工作区状态
        status_result = subprocess.run(
            "git status --porcelain",
            shell=True,
            capture_output=True,
            text=True,
            cwd=st_dir,
        )

        # 步骤5：如果有未提交的更改，先保存
        if status_result.stdout.strip():
            print("检测到未提交的更改，使用stash保存...")

            # 过滤掉package-lock.json的更改
            modified_lines = status_result.stdout.strip().split("\n")
            non_package_lock_changes = [
                line
                for line in modified_lines
                if line.strip() and "package-lock.json" not in line
            ]

            if non_package_lock_changes:
                stash_cmd = f'git stash push -m "版本切换前保存{commit_hash[:7]}"'
                stash_result = subprocess.run(
                    stash_cmd, shell=True, capture_output=True, text=True, cwd=st_dir
                )

                if stash_result.returncode != 0:
                    return (
                        False,
                        f"保存本地更改失败: {stash_result.stderr.strip() if stash_result.stderr else '未知错误'}",
                    )
                print("本地更改已暂存")
            else:
                # 只有package-lock.json被修改，恢复它
                subprocess.run(
                    "git checkout -- package-lock.json",
                    shell=True,
                    capture_output=True,
                    text=True,
                    cwd=st_dir,
                )

        # 步骤6：使用git reset --hard切换到指定commit（保持在release分支上）
        print(f"在release分支上切换到commit {commit_hash[:7]}...")
        reset_cmd = f"git reset --hard {commit_hash}"

        reset_result = subprocess.run(
            reset_cmd, shell=True, capture_output=True, text=True, cwd=st_dir
        )

        if reset_result.returncode == 0:
            # 验证当前状态
            verify_branch = subprocess.run(
                "git rev-parse --abbrev-ref HEAD",
                shell=True,
                capture_output=True,
                text=True,
                cwd=st_dir,
            )

            if verify_branch.returncode == 0:
                branch_name = verify_branch.stdout.strip()
                if branch_name == "release":
                    return True, f"成功切换到版本 {commit_hash[:7]}（在release分支上）"
                else:
                    # 理论上不应该发生，但万一发生了
                    return False, f"切换后未在release分支上，当前在: {branch_name}"
            else:
                return True, f"成功切换到版本 {commit_hash[:7]}"
        else:
            error_msg = (
                reset_result.stderr.strip() if reset_result.stderr else "未知错误"
            )
            return False, f"切换失败: {error_msg}"

    except Exception as e:
        print(f"切换过程中发生异常: {str(e)}")
        import traceback

        traceback.print_exc()
        return False, f"切换过程中发生错误: {str(e)}"


def checkout_branch_force(branch, remote=None, st_dir=None):
    if st_dir is None:
        st_dir = os.path.join(os.getcwd(), "SillyTavern")

    if not os.path.exists(st_dir):
        return False, "SillyTavern目录不存在"

    git_dir = os.path.join(st_dir, ".git")
    if not os.path.exists(git_dir):
        return False, "SillyTavern目录不是Git仓库"

    try:
        remote_name = remote or "origin"
        remote_branch = f"{remote_name}/{branch}"

        fetch_result = subprocess.run(
            ["git", "fetch", remote_name],
            cwd=st_dir,
            capture_output=True,
            text=True,
        )
        if fetch_result.returncode != 0:
            return False, f"fetch远程失败: {fetch_result.stderr.strip()}"

        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=st_dir,
            capture_output=True,
            text=True,
        )

        has_local_changes = bool(status_result.stdout.strip())

        if has_local_changes:
            modified_lines = status_result.stdout.strip().split("\n")
            non_package_lock_changes = [
                line
                for line in modified_lines
                if line.strip() and "package-lock.json" not in line
            ]

            if not non_package_lock_changes:
                subprocess.run(
                    ["git", "checkout", "--", "package-lock.json"],
                    cwd=st_dir,
                    capture_output=True,
                    text=True,
                )
                print("已自动恢复 package-lock.json 的本地更改")
            else:
                print("检测到未提交的本地更改，正在暂存...")
                stash_result = subprocess.run(
                    ["git", "stash", "push", "-m", "自动暂存: 切换分支前保存"],
                    cwd=st_dir,
                    capture_output=True,
                    text=True,
                )
                if stash_result.returncode != 0:
                    if "package-lock.json" in status_result.stdout:
                        subprocess.run(
                            ["git", "checkout", "--", "package-lock.json"],
                            cwd=st_dir,
                            capture_output=True,
                            text=True,
                        )
                        print("已恢复 package-lock.json，继续切换分支")
                    else:
                        return False, f"暂存本地更改失败: {stash_result.stderr.strip()}"
                else:
                    print("本地更改已暂存")

        print(f"切换到 {branch} 分支...")
        checkout_result = subprocess.run(
            ["git", "checkout", "-B", branch, remote_branch],
            cwd=st_dir,
            capture_output=True,
            text=True,
        )

        if checkout_result.returncode != 0:
            error_msg = checkout_result.stderr.strip()
            if "not found" in error_msg.lower() or "did not match" in error_msg.lower():
                print(f"远程分支 {remote_branch} 不存在，尝试使用本地分支...")
                checkout_result = subprocess.run(
                    ["git", "checkout", "-B", branch],
                    cwd=st_dir,
                    capture_output=True,
                    text=True,
                )

        if checkout_result.returncode != 0:
            return False, f"切换到 {branch} 分支失败: {checkout_result.stderr.strip()}"

        print(f"成功切换到 {branch} 分支")
        return True, f"成功切换到 {branch} 分支"

    except Exception as e:
        return False, f"切换过程中发生错误: {str(e)}"


def check_git_status(st_dir=None):
    """
    检查Git工作区状态（是否有未提交的更改）

    Args:
        st_dir (str): SillyTavern目录路径

    Returns:
        tuple: (is_clean: bool, message: str)
    """
    if st_dir is None:
        st_dir = os.path.join(os.getcwd(), "SillyTavern")

    try:
        # 检查是否有未提交的更改
        result = subprocess.run(
            "git status --porcelain",
            shell=True,
            capture_output=True,
            text=True,
            cwd=st_dir,
        )

        # 如果输出为空，说明工作区干净
        if not result.stdout.strip():
            return True, "工作区干净"
        else:
            # 检查修改的文件
            modified_lines = result.stdout.strip().split("\n")
            # 过滤掉package-lock.json的更改（这是由于使用镜像NPM源导致的）
            non_package_lock_changes = [
                line
                for line in modified_lines
                if line.strip() and "package-lock.json" not in line
            ]

            if not non_package_lock_changes:
                # 只有package-lock.json被修改，自动恢复它
                try:
                    subprocess.run(
                        "git checkout -- package-lock.json",
                        shell=True,
                        capture_output=True,
                        text=True,
                        cwd=st_dir,
                    )
                    return True, "工作区干净（已自动恢复package-lock.json）"
                except:
                    pass

            # 如果还有其他文件被修改，返回错误
            modified_count = len(non_package_lock_changes)
            if modified_count > 0:
                return False, f"检测到{modified_count}个文件有未提交的更改"
            else:
                return True, "工作区干净"

    except Exception as e:
        return False, f"检查Git状态时出错: {str(e)}"


def get_current_commit(st_dir=None):
    """
    获取当前SillyTavern的commit hash

    Args:
        st_dir (str): SillyTavern目录路径

    Returns:
        tuple: (success: bool, commit_hash: str or None, message: str)
    """
    if st_dir is None:
        st_dir = os.path.join(os.getcwd(), "SillyTavern")

    try:
        result = subprocess.run(
            "git rev-parse HEAD", shell=True, capture_output=True, text=True, cwd=st_dir
        )

        if result.returncode == 0:
            commit_hash = result.stdout.strip()
            return True, commit_hash, "成功获取当前commit"
        else:
            return False, None, f"获取commit失败: {result.stderr}"

    except Exception as e:
        return False, None, f"获取commit时出错: {str(e)}"


def get_st_tags(st_dir=None):
    """
    获取SillyTavern的所有Git tag列表（用于版本管理）

    Args:
        st_dir (str): SillyTavern目录路径，默认为当前目录下的SillyTavern文件夹

    Returns:
        tuple: (success: bool, tags_data: dict or None, message: str)
        tags_data格式:
        {
            'versions': {
                '1.16.0': {'commit': 'abc123...', 'date': '2026-02-14T17:46:49+02:00', 'tag_name': '1.16.0'},
                ...
            },
            'latest': '1.16.0'
        }
    """
    import re

    if st_dir is None:
        st_dir = os.path.join(os.getcwd(), "SillyTavern")

    # 检查目录是否存在
    if not os.path.exists(st_dir):
        return False, None, "SillyTavern目录不存在"

    # 检查是否是Git仓库
    git_dir = os.path.join(st_dir, ".git")
    if not os.path.exists(git_dir):
        return False, None, "SillyTavern目录不是Git仓库"

    try:
        # 步骤1: 获取本地tag列表
        list_tags_result = subprocess.run(
            "git tag -l",
            shell=True,
            capture_output=True,
            text=True,
            cwd=st_dir,
        )

        if list_tags_result.returncode != 0:
            return False, None, f"获取tag列表失败: {list_tags_result.stderr.strip()}"

        all_tags = [tag.strip() for tag in list_tags_result.stdout.strip().split('\n') if tag.strip()]

        # 步骤2: 过滤只保留语义化版本格式的tag (v{x.y.z} 或 {x.y.z})，且版本 >= 1.13.0
        version_tag_pattern = re.compile(r'^[vV]?(\d+)\.(\d+)\.(\d+)(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$')

        def normalize_version(tag_name):
            """规范化版本字符串，去除v前缀"""
            if tag_name.startswith('v') or tag_name.startswith('V'):
                return tag_name[1:]
            return tag_name

        def version_gte_1_13_0(version_str):
            """检查版本是否 >= 1.13.0"""
            try:
                parts = version_str.split('.')
                major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
                # 1.13.0 = (1, 13, 0)
                if major > 1:
                    return True
                if major == 1:
                    if minor > 13:
                        return True
                    if minor == 13:
                        return patch >= 0
                    return False
                return False
            except (ValueError, IndexError):
                return False

        versions = {}
        valid_tags = []

        for tag in all_tags:
            version_str = normalize_version(tag)
            if version_tag_pattern.match(version_str) and version_gte_1_13_0(version_str):
                valid_tags.append((tag, version_str))

        # 步骤3: 获取每个有效tag的commit和日期信息
        for tag_name, version_str in valid_tags:
            # 使用 git show 获取 tag 的 commit hash 和日期
            # %H = 完整commit hash, %aI = ISO 8601 格式的作者日期
            show_result = subprocess.run(
                f'git show {tag_name} --format="%H|%aI" -s',
                shell=True,
                capture_output=True,
                text=True,
                cwd=st_dir,
            )

            if show_result.returncode == 0:
                output = show_result.stdout.strip()
                # 解析输出（去掉首尾引号）
                output = output.strip("'\"")
                parts = output.split('|')
                if len(parts) == 2:
                    commit_hash = parts[0]
                    date_str = parts[1]
                    versions[version_str] = {
                        'commit': commit_hash,
                        'date': date_str,
                        'tag_name': tag_name  # 保存原始tag名称
                    }

        # 步骤4: 确定最新版本（使用语义化版本排序）
        try:
            from packaging import version as pkg_version
            sorted_versions = sorted(
                versions.keys(),
                key=lambda v: pkg_version.parse(v),
                reverse=True
            )
            latest_version = sorted_versions[0] if sorted_versions else ''
        except ImportError:
            # 如果没有 packaging 模块，使用简单字符串排序
            sorted_versions = sorted(versions.keys(), reverse=True)
            latest_version = sorted_versions[0] if sorted_versions else ''

        tags_data = {
            'versions': versions,
            'latest': latest_version
        }

        print(f"成功获取 {len(versions)} 个版本标签")
        return True, tags_data, f"成功获取 {len(versions)} 个版本"

    except Exception as e:
        return False, None, f"获取tag列表时出错: {str(e)}"


def fetch_remote_tags(st_dir=None):
    """
    从远程仓库获取所有tags

    Args:
        st_dir (str): SillyTavern目录路径，默认为当前目录下的SillyTavern文件夹

    Returns:
        tuple: (success: bool, message: str)
    """
    if st_dir is None:
        st_dir = os.path.join(os.getcwd(), "SillyTavern")

    # 检查目录是否存在
    if not os.path.exists(st_dir):
        return False, "SillyTavern目录不存在"

    # 检查是否是Git仓库
    git_dir = os.path.join(st_dir, ".git")
    if not os.path.exists(git_dir):
        return False, "SillyTavern目录不是Git仓库"

    try:
        result = subprocess.run(
            "git fetch origin --tags",
            shell=True,
            capture_output=True,
            text=True,
            cwd=st_dir,
        )

        if result.returncode == 0:
            return True, "成功从远程获取tags"
        else:
            return False, f"获取远程tags失败: {result.stderr}"

    except Exception as e:
        return False, f"获取远程tags时出错: {str(e)}"


# 使用示例
if __name__ == "__main__":
    # 示例1：切换到指定版本
    print("=== 示例1：切换版本 ===")
    success, message = checkout_st_version("abc1234")
    print(f"结果: {success}")
    print(f"消息: {message}")

    # 示例2：检查Git状态
    print("\n=== 示例2：检查Git状态 ===")
    is_clean, message = check_git_status()
    print(f"工作区干净: {is_clean}")
    print(f"消息: {message}")

    # 示例3：获取当前commit
    print("\n=== 示例3：获取当前commit ===")
    success, commit, message = get_current_commit()
    if success:
        print(f"当前commit: {commit[:7]}")
    else:
        print(f"错误: {message}")
