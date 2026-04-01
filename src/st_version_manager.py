"""
SillyTavern版本管理器
用于获取和管理SillyTavern的版本信息
"""
import json
import os
import threading
import asyncio
from datetime import datetime

from .utils import MirrorBuilder


class STVersionManager:
    """SillyTavern版本管理器"""

    def __init__(self):
        self.st_dir = os.path.join(os.getcwd(), "SillyTavern")

    def get_versions_json_url(self, mirror="github"):
        """根据镜像返回 URL"""
        return MirrorBuilder.build_raw_url(
            org="LingyeSoul",
            repo="SillyTavern",
            branch="release",
            path="STVersions.json",
            mirror=mirror
        )

    async def fetch_st_versions_async(self, mirror="github"):
        """异步从远程获取STVersions.json"""
        try:
            import aiohttp

            url = self.get_versions_json_url(mirror)

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    headers={'User-Agent': 'SillyTavernLauncher/1.0'},
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return {
                            'success': True,
                            'versions': data.get('versions', {}),
                            'latest': data.get('latest', ''),
                            'error': None
                        }
                    else:
                        return {
                            'success': False,
                            'versions': {},
                            'latest': '',
                            'error': f'HTTP {response.status}'
                        }
        except Exception as e:
            return {
                'success': False,
                'versions': {},
                'latest': '',
                'error': f'获取版本列表失败: {str(e)}'
            }

    def run_fetch_async(self, mirror="github"):
        """同步包装器，用于在线程中运行异步获取版本列表"""
        def run_loop():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(self.fetch_st_versions_async(mirror))
            finally:
                loop.close()

        result = {}

        def worker():
            nonlocal result
            result = run_loop()

        thread = threading.Thread(target=worker)
        thread.daemon = True
        thread.start()
        thread.join(timeout=20)

        if thread.is_alive():
            return {
                'success': False,
                'versions': {},
                'latest': '',
                'error': '获取版本列表超时'
            }

        return result

    def get_current_version(self):
        """从package.json获取当前版本"""
        try:
            package_json_path = os.path.join(self.st_dir, 'package.json')

            if not os.path.exists(package_json_path):
                return {
                    'success': False,
                    'version': 'unknown',
                    'error': 'SillyTavern未安装或package.json不存在'
                }

            with open(package_json_path, 'r', encoding='utf-8') as f:
                package_data = json.load(f)
                version = package_data.get('version', 'unknown')

                return {
                    'success': True,
                    'version': version,
                    'error': None
                }

        except Exception as e:
            return {
                'success': False,
                'version': 'unknown',
                'error': f'读取失败: {str(e)}'
            }

    def format_version_list(self, versions, latest_version, limit=20):
        """格式化版本列表用于显示"""
        formatted = []
        sorted_versions = sorted(versions.items(), reverse=True)[:limit]

        for ver_str, ver_data in sorted_versions:
            commit = ver_data.get('commit', '')[:7]
            date_str = ver_data.get('date', '')
            is_latest = ver_str == latest_version

            # 转换日期格式
            try:
                if date_str:
                    dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    date_str = dt.strftime('%Y-%m-%d')
            except:
                pass

            latest_mark = " [最新]" if is_latest else ""
            formatted.append(f"  v{ver_str}{latest_mark} - {commit} ({date_str})")

        return formatted


if __name__ == "__main__":
    # 测试版本管理器
    manager = STVersionManager()

    print("=== 测试获取版本列表 ===")
    result = manager.run_fetch_async(mirror="github")

    if result['success']:
        print(f"最新版本: v{result['latest']}")
        print("\n可用版本:")
        versions = manager.format_version_list(result['versions'], result['latest'], limit=10)
        for v in versions:
            print(v)
    else:
        print(f"获取失败: {result['error']}")

    print("\n=== 测试获取当前版本 ===")
    current = manager.get_current_version()
    if current['success']:
        print(f"当前版本: v{current['version']}")
    else:
        print(f"错误: {current['error']}")
