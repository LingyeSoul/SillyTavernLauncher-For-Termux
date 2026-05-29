"""
SillyTavernLauncher 更新检查器
用于检查启动器是否有新版本
"""
import asyncio
import aiohttp
import threading

from utils import MirrorBuilder


class UpdateChecker:
    """版本更新检查器"""

    def __init__(self, current_version: str = "0.5.0", mirror: str = "github"):
        """
        初始化版本检查器

        Args:
            current_version: 当前版本号
            mirror: GitHub镜像源 ("github", "ghproxy", "mirrorgo" 等)
        """
        self.current_version = current_version
        self.mirror = mirror

    async def get_latest_release_version_from_raw(self) -> str:
        """
        通过 GitHub RAW 链接获取最新版本号

        Returns:
            最新版本号，如果出错则返回 None
        """
        # 使用 MirrorBuilder 构建 RAW URL
        raw_url = MirrorBuilder.build_raw_url(
            org="LingyeSoul",
            repo="SillyTavernLauncher-For-Termux",
            branch="main",
            path="src/version.py",
            mirror=self.mirror
        )

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    raw_url,
                    headers={'User-Agent': 'SillyTavernLauncher/1.0'},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        content = await response.text()
                        # 解析内容提取版本号
                        for line in content.split('\n'):
                            if line.startswith('version='):
                                # 提取版本号值
                                version = line.split('=')[1].strip().strip("'\"")
                                return version
                    return None

        except Exception as e:
            return None

    def is_dev_version(self, version_str: str) -> bool:
        """
        检查版本是否为开发版

        Args:
            version_str: 版本字符串

        Returns:
            如果是开发版则返回True，否则返回False
        """
        dev_keywords = ['dev', 'alpha', 'beta', 'rc', 'test']
        version_lower = version_str.lower()
        for keyword in dev_keywords:
            if keyword in version_lower:
                return True
        return False

    def compare_versions(self, local_version: str, remote_version: str, allow_dev: bool = False) -> int:
        """
        比较两个版本号

        Args:
            local_version: 本地版本号
            remote_version: 远程版本号
            allow_dev: 是否允许开发版更新

        Returns:
            1表示本地版本更新，-1表示远程版本更新，0表示版本相同
        """
        # 如果不允许开发版更新，且远程版本是开发版，则不认为有更新
        if not allow_dev and self.is_dev_version(remote_version):
            return 0

        # 移除版本号中的前缀"v"
        local_clean = local_version.lstrip("v")
        remote_clean = remote_version.lstrip("v")

        # 分离版本号
        local_nums = [int(x) for x in local_clean.split(".") if x.isdigit()]
        remote_nums = [int(x) for x in remote_clean.split(".") if x.isdigit()]

        # 比较版本号
        for i in range(max(len(local_nums), len(remote_nums))):
            local_num = local_nums[i] if i < len(local_nums) else 0
            remote_num = remote_nums[i] if i < len(remote_nums) else 0

            if local_num > remote_num:
                return 1
            elif local_num < remote_num:
                return -1

        return 0

    async def check_for_updates(self, allow_dev: bool = False) -> dict:
        """
        检查是否有更新版本

        Args:
            allow_dev: 是否允许开发版更新

        Returns:
            包含检查结果的字典：
            {
                "has_error": bool,  # 是否有错误
                "error_message": str or None,  # 错误信息
                "current_version": str,  # 当前版本
                "latest_version": str or None,  # 最新版本
                "has_update": bool,  # 是否有更新
                "is_dev_version": bool  # 是否为开发版
            }
        """
        latest_version = await self.get_latest_release_version_from_raw()

        if latest_version is None:
            return {
                "has_error": True,
                "error_message": "无法获取最新版本信息",
                "current_version": self.current_version,
                "latest_version": None,
                "has_update": False,
                "is_dev_version": False
            }

        try:
            is_dev = self.is_dev_version(latest_version)
            comparison = self.compare_versions(self.current_version, latest_version, allow_dev=allow_dev)
        except Exception as e:
            return {
                "has_error": True,
                "error_message": f"版本比较时出错: {str(e)}",
                "current_version": self.current_version,
                "latest_version": latest_version,
                "has_update": False,
                "is_dev_version": False
            }

        return {
            "has_error": False,
            "error_message": None,
            "current_version": self.current_version,
            "latest_version": latest_version,
            "has_update": comparison < 0,
            "is_dev_version": is_dev
        }

    def check_update_sync(self, timeout=10, allow_dev: bool = False) -> dict:
        """
        同步检查更新

        Args:
            timeout: 超时时间（秒）
            allow_dev: 是否允许开发版更新

        Returns:
            检查结果字典
        """
        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(self.check_for_updates(allow_dev=allow_dev))
            finally:
                loop.close()

        result = [None]
        def worker():
            result[0] = run_loop()

        thread = threading.Thread(target=worker)
        thread.daemon = True
        thread.start()
        thread.join(timeout=timeout)

        if thread.is_alive():
            return {
                "has_error": True,
                "error_message": "检查超时",
                "current_version": self.current_version,
                "latest_version": None,
                "has_update": False,
                "is_dev_version": False
            }

        return result[0]
