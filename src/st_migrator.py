"""
SillyTavern 迁移模块

提供检测、验证和迁移其他 SillyTavern 安装的功能。
"""

import os
import json
import shutil
import subprocess
from datetime import datetime
from dataclasses import dataclass
from typing import List, Optional, Tuple
from pathlib import Path


@dataclass
class STInstallation:
    """SillyTavern 安装信息数据类"""
    path: str                      # 安装路径
    version: str = "unknown"       # 版本号（从package.json读取）
    size: int = 0                  # 目录大小（字节）
    has_git: bool = False          # 是否有.git目录
    git_branch: str = ""           # Git分支
    git_commit: str = ""           # Git commit hash
    has_data: bool = False         # 是否有data目录
    data_size: int = 0             # data目录大小
    has_config: bool = False       # 是否有config.yaml
    is_valid: bool = False         # 是否为有效安装
    install_type: str = ""         # 安装类型（git/manual）
    last_modified: float = 0       # 最后修改时间


class STMigrator:
    """SillyTavern 迁移器"""

    def __init__(self, target_path: Optional[str] = None):
        """
        初始化迁移器

        Args:
            target_path: 目标安装路径，默认为 ./SillyTavern
        """
        if target_path is None:
            target_path = os.path.join(os.getcwd(), "SillyTavern")
        self.target_path = os.path.abspath(target_path)
        self.current_path = os.path.abspath(os.getcwd())

        # 排除路径（不扫描的目录）
        self.exclude_paths = [
            self.target_path,
            os.path.join(self.current_path, "SillyTavern"),
        ]

        # 排除模式
        self.exclude_patterns = [
            "*.backup.*",
            "*/tmp/*",
            "*/node_modules/*",
        ]

    def scan_for_installations(self, search_paths: Optional[List[str]] = None) -> List[STInstallation]:
        """
        扫描指定的路径列表查找 SillyTavern 安装

        Args:
            search_paths: 要搜索的路径列表，默认使用预设路径

        Returns:
            找到的 SillyTavern 安装列表
        """
        if search_paths is None:
            search_paths = self._get_default_search_paths()

        installations = []
        seen_paths = set()

        print("正在扫描 SillyTavern 安装...")

        for base_path in search_paths:
            if not os.path.exists(base_path):
                continue

            # 扫描路径
            if os.path.isfile(base_path):
                continue

            # 检查基础路径本身是否是 SillyTavern 安装
            if self._should_scan_path(base_path):
                install = self.validate_installation(base_path)
                if install.is_valid and base_path not in seen_paths:
                    installations.append(install)
                    seen_paths.add(base_path)

            # 递归扫描子目录（最多2层深度）
            try:
                for root, dirs, files in os.walk(base_path):
                    # 限制深度
                    depth = root[len(base_path):].count(os.sep)
                    if depth >= 2:
                        dirs[:] = []  # 不继续深入
                        continue

                    # 检查当前目录是否是 SillyTavern 安装
                    if root in seen_paths:
                        continue

                    if self._should_scan_path(root):
                        install = self.validate_installation(root)
                        if install.is_valid:
                            installations.append(install)
                            seen_paths.add(root)

                    # 过滤掉不需要扫描的目录
                    dirs[:] = [d for d in dirs if not self._is_excluded_dir(os.path.join(root, d))]

            except (PermissionError, OSError) as e:
                # 跳过无权限访问的目录
                continue

        return installations

    def validate_installation(self, path: str) -> STInstallation:
        """
        验证路径是否为有效的 SillyTavern 安装

        Args:
            path: 要验证的路径

        Returns:
            STInstallation 对象
        """
        path = os.path.abspath(path)

        # 1. 检查基本路径存在性
        if not os.path.isdir(path):
            return STInstallation(path=path, is_valid=False)

        # 2. 检查必需文件
        package_json = os.path.join(path, "package.json")
        server_js = os.path.join(path, "server.js")
        public_dir = os.path.join(path, "public")

        if not os.path.exists(package_json):
            return STInstallation(path=path, is_valid=False)

        # 3. 读取 package.json
        version = "unknown"
        try:
            with open(package_json, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if data.get("name") != "SillyTavern":
                    return STInstallation(path=path, is_valid=False)
                version = data.get("version", "unknown")
        except (json.JSONDecodeError, IOError):
            return STInstallation(path=path, is_valid=False)

        # 4. 收集其他信息
        has_git = os.path.exists(os.path.join(path, ".git"))
        has_data = os.path.exists(os.path.join(path, "data"))
        has_config = os.path.exists(os.path.join(path, "config.yaml"))

        # 5. 计算大小（跳过 node_modules）
        size = self.calculate_directory_size(path)

        # 6. 获取 Git 信息
        git_branch, git_commit = "", ""
        if has_git:
            git_branch, git_commit = self.get_git_info(path)

        # 7. 计算 data 目录大小
        data_size = 0
        if has_data:
            data_dir = os.path.join(path, "data")
            data_size = self.calculate_directory_size(data_dir)

        # 8. 获取最后修改时间
        last_modified = os.path.getmtime(path)

        return STInstallation(
            path=path,
            version=version,
            size=size,
            has_git=has_git,
            git_branch=git_branch,
            git_commit=git_commit,
            has_data=has_data,
            data_size=data_size,
            has_config=has_config,
            is_valid=True,
            install_type="git" if has_git else "manual",
            last_modified=last_modified
        )

    def migrate_installation(self, source: STInstallation, target_path: str,
                            mode: str = "move", backup: bool = True,
                            confirm_callback=None) -> bool:
        """
        执行迁移操作

        Args:
            source: 源安装信息
            target_path: 目标路径
            mode: 迁移模式（move/copy_data/copy_config/copy_all）
            backup: 是否备份现有安装
            confirm_callback: 确认回调函数

        Returns:
            迁移是否成功
        """
        if not source.is_valid:
            print(f"✗ 源安装无效: {source.path}")
            return False

        # 检查源路径是否存在
        if not os.path.exists(source.path):
            print(f"✗ 源路径不存在: {source.path}")
            return False

        # 检查源和目标是否相同
        if os.path.abspath(source.path) == os.path.abspath(target_path):
            print("✗ 源路径和目标路径相同")
            return False

        # 备份现有安装
        if backup and os.path.exists(target_path):
            target_install = self.validate_installation(target_path)
            if target_install.is_valid:
                print(f"\n目标位置已存在有效安装")
                if confirm_callback:
                    if not confirm_callback("是否先备份现有安装？"):
                        backup = False

                if backup:
                    backup_path = self.backup_existing_installation(target_path)
                    print(f"✓ 备份已创建: {backup_path}")

        # 执行迁移
        print(f"\n正在迁移...")
        try:
            if mode == "move":
                success = self._move_installation(source.path, target_path)
            elif mode == "copy_data":
                success = self._copy_data_only(source.path, target_path)
            elif mode == "copy_config":
                success = self._copy_config_only(source.path, target_path)
            elif mode == "copy_all":
                success = self._copy_installation(source.path, target_path)
            else:
                print(f"✗ 未知的迁移模式: {mode}")
                return False

            if success:
                print(f"\n✓ 迁移完成！")
                print(f"  目标位置: {target_path}")
                return True
            else:
                print(f"\n✗ 迁移失败")
                return False

        except Exception as e:
            print(f"\n✗ 迁移过程中出错: {e}")
            return False

    def backup_existing_installation(self, path: str) -> str:
        """
        备份现有的 SillyTavern 安装

        Args:
            path: 要备份的路径

        Returns:
            备份路径
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = f"{path}.backup.{timestamp}"

        print(f"正在备份到: {backup_path}")
        shutil.copytree(path, backup_path)

        return backup_path

    def calculate_directory_size(self, path: str, exclude: Optional[List[str]] = None) -> int:
        """
        计算目录大小

        Args:
            path: 目录路径
            exclude: 要排除的子目录列表

        Returns:
            大小（字节）
        """
        if exclude is None:
            exclude = ["node_modules", ".git"]

        total_size = 0

        try:
            for dirpath, dirnames, filenames in os.walk(path):
                # 过滤掉不需要的目录
                dirnames[:] = [d for d in dirnames if d not in exclude]

                for filename in filenames:
                    file_path = os.path.join(dirpath, filename)
                    try:
                        total_size += os.path.getsize(file_path)
                    except (OSError, PermissionError):
                        # 跳过无法访问的文件
                        continue
        except (OSError, PermissionError):
            pass

        return total_size

    def get_git_info(self, path: str) -> Tuple[str, str]:
        """
        获取 Git 仓库信息

        Args:
            path: Git 仓库路径

        Returns:
            (分支名, commit hash) 元组
        """
        branch = ""
        commit = ""

        try:
            # 获取分支名
            result = subprocess.run(
                ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                cwd=path,
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                branch = result.stdout.strip()

            # 获取 commit hash
            result = subprocess.run(
                ['git', 'rev-parse', 'HEAD'],
                cwd=path,
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                commit = result.stdout.strip()[:8]  # 取前8位

        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        return (branch, commit)

    def display_installation_list(self, installations: List[STInstallation]):
        """
        显示找到的安装列表

        Args:
            installations: 安装列表
        """
        if not installations:
            print("\n未找到其他 SillyTavern 安装")
            return

        print(f"\n找到 {len(installations)} 个安装：\n")

        for i, install in enumerate(installations, 1):
            # 格式化大小
            size_mb = install.size / (1024 * 1024)

            # 格式化时间
            mod_time = datetime.fromtimestamp(install.last_modified).strftime("%Y-%m-%d %H:%M:%S")

            # 判断是否是当前项目的安装
            is_current = os.path.abspath(install.path) == self.target_path
            current_marker = " [当前项目]" if is_current else ""

            print(f"[{i}] {install.path}{current_marker}")
            print(f"    版本: {install.version}")
            print(f"    大小: {size_mb:.1f} MB")
            print(f"    类型: {'Git 仓库' if install.has_git else '手动安装'}")

            if install.has_git:
                git_info = f" ({install.git_branch})"
                if install.git_commit:
                    git_info += f" [{install.git_commit}]"
                print(f"    分支: {install.git_branch}{git_info}")

            print(f"    最后修改: {mod_time}")

            # 显示额外信息
            extras = []
            if install.has_data:
                extras.append(f"data目录")
            if install.has_config:
                extras.append(f"config.yaml")

            if extras:
                print(f"    包含: {', '.join(extras)}")

            print()

    def interactive_migrate(self) -> bool:
        """
        交互式迁移流程

        Returns:
            是否成功完成迁移
        """
        print("\n" + "="*50)
        print("SillyTavern 安装迁移向导")
        print("="*50)

        # 1. 扫描安装
        installations = self.scan_for_installations()

        # 过滤掉当前项目的安装
        installations = [
            inst for inst in installations
            if os.path.abspath(inst.path) != self.target_path
        ]

        if not installations:
            print("\n未找到可迁移的其他 SillyTavern 安装")
            return False

        # 2. 显示列表
        self.display_installation_list(installations)

        # 3. 选择源安装
        while True:
            try:
                choice = input(f"请选择要迁移的安装 [1-{len(installations)}, 0取消]: ").strip()
                if choice == "0":
                    print("取消迁移")
                    return False

                index = int(choice) - 1
                if 0 <= index < len(installations):
                    source = installations[index]
                    break
                else:
                    print(f"无效选择，请输入 0-{len(installations)} 之间的数字")
            except ValueError:
                print("请输入有效的数字")
            except KeyboardInterrupt:
                print("\n\n取消迁移")
                return False

        # 4. 显示源安装详情
        print(f"\n检测到源安装：")
        print(f"  路径: {source.path}")
        print(f"  版本: {source.version}")
        print(f"  大小: {source.size / (1024 * 1024):.1f} MB")
        print(f"  类型: {'Git 仓库' if source.has_git else '手动安装'}")

        # 5. 显示目标信息
        print(f"\n目标位置: {self.target_path}")

        target_exists = os.path.exists(self.target_path)
        if target_exists:
            target_install = self.validate_installation(self.target_path)
            if target_install.is_valid:
                print(f"  目标已存在: v{target_install.version}")

        # 6. 选择迁移模式
        print(f"\n选择迁移模式：")
        print("1. 移动整个安装（推荐）")
        print("2. 只复制用户数据（data目录）")
        print("3. 只复制配置文件（config.yaml）")
        print("4. 复制整个安装（保留源文件）")
        print("0. 取消")

        mode_map = {
            "1": "move",
            "2": "copy_data",
            "3": "copy_config",
            "4": "copy_all"
        }

        while True:
            try:
                choice = input("请选择 [0-4]: ").strip()
                if choice == "0":
                    print("取消迁移")
                    return False

                if choice in mode_map:
                    mode = mode_map[choice]
                    break
                else:
                    print("无效选择，请输入 0-4 之间的数字")
            except KeyboardInterrupt:
                print("\n\n取消迁移")
                return False

        # 7. 确认迁移
        if mode == "move":
            print(f"\n⚠️  警告：移动操作将从源位置删除文件")

        confirm = input(f"\n确认从 {source.path} 迁移到 {self.target_path}？(y/N): ").strip()
        if confirm.lower() != 'y':
            print("取消迁移")
            return False

        # 8. 执行迁移
        def confirm_callback(prompt: str) -> bool:
            """确认回调"""
            response = input(f"{prompt} (Y/n): ").strip()
            return response.lower() != 'n'

        success = self.migrate_installation(
            source=source,
            target_path=self.target_path,
            mode=mode,
            backup=target_exists,
            confirm_callback=confirm_callback
        )

        return success

    def _get_default_search_paths(self) -> List[str]:
        """获取默认搜索路径列表"""
        paths = []

        # 1. 当前目录及子目录
        paths.append(self.current_path)

        # 2. 用户主目录
        home_dir = os.path.expanduser("~")
        paths.append(home_dir)
        paths.append(os.path.join(home_dir, "home"))
        paths.append(os.path.join(home_dir, "SillyTavern"))

        # 3. Termux 特定路径
        termux_storage = os.path.join(home_dir, "storage", "shared")
        paths.append(termux_storage)
        paths.append(os.path.join(termux_storage, "SillyTavern"))

        return paths

    def _should_scan_path(self, path: str) -> bool:
        """判断路径是否应该被扫描"""
        path = os.path.abspath(path)

        # 检查是否在排除列表中
        for exclude_path in self.exclude_paths:
            if path.startswith(os.path.abspath(exclude_path)):
                return False

        # 检查是否匹配排除模式
        for pattern in self.exclude_patterns:
            if pattern in path:
                return False

        return True

    def _is_excluded_dir(self, path: str) -> bool:
        """判断目录是否应该被排除"""
        excluded_dirs = [
            "node_modules",
            ".git",
            "__pycache__",
            "venv",
            ".venv",
            "tmp",
            "temp"
        ]

        dirname = os.path.basename(path)
        return dirname in excluded_dirs

    def _move_installation(self, source: str, target: str) -> bool:
        """移动整个安装"""
        try:
            # 如果目标存在，先删除
            if os.path.exists(target):
                if os.path.isdir(target):
                    shutil.rmtree(target)
                else:
                    os.remove(target)

            # 移动目录
            shutil.move(source, target)
            print(f"✓ 文件已移动")

            # 验证迁移结果
            if self.validate_installation(target).is_valid:
                print(f"✓ 迁移验证成功")
                return True
            else:
                print(f"✗ 迁移验证失败")
                return False

        except Exception as e:
            print(f"✗ 移动失败: {e}")
            return False

    def _copy_installation(self, source: str, target: str) -> bool:
        """复制整个安装"""
        try:
            # 如果目标存在，先删除
            if os.path.exists(target):
                if os.path.isdir(target):
                    shutil.rmtree(target)
                else:
                    os.remove(target)

            # 复制目录
            print(f"正在复制文件...")
            shutil.copytree(source, target)
            print(f"✓ 文件已复制")

            # 验证迁移结果
            if self.validate_installation(target).is_valid:
                print(f"✓ 迁移验证成功")
                return True
            else:
                print(f"✗ 迁移验证失败")
                return False

        except Exception as e:
            print(f"✗ 复制失败: {e}")
            return False

    def _copy_data_only(self, source: str, target: str) -> bool:
        """只复制用户数据"""
        try:
            source_data = os.path.join(source, "data")
            target_data = os.path.join(target, "data")

            if not os.path.exists(source_data):
                print(f"✗ 源安装没有 data 目录")
                return False

            # 如果目标没有 data 目录，先创建
            if not os.path.exists(target_data):
                os.makedirs(target_data, exist_ok=True)

            # 复制 data 目录
            print(f"正在复制 data 目录...")
            if os.path.exists(target_data):
                shutil.rmtree(target_data)
            shutil.copytree(source_data, target_data)
            print(f"✓ 数据已复制")

            return True

        except Exception as e:
            print(f"✗ 复制数据失败: {e}")
            return False

    def _copy_config_only(self, source: str, target: str) -> bool:
        """只复制配置文件"""
        try:
            config_files = ["config.yaml", "whitelist.txt"]
            copied = []

            for filename in config_files:
                source_file = os.path.join(source, filename)
                target_file = os.path.join(target, filename)

                if os.path.exists(source_file):
                    shutil.copy2(source_file, target_file)
                    copied.append(filename)
                    print(f"✓ 已复制 {filename}")

            if copied:
                print(f"✓ 配置文件已复制")
                return True
            else:
                print(f"✗ 未找到配置文件")
                return False

        except Exception as e:
            print(f"✗ 复制配置失败: {e}")
            return False
