"""
SillyTavern版本管理器
用于获取和管理SillyTavern的版本信息
"""
import json
import os
from datetime import datetime

from git_utils import get_st_tags, fetch_remote_tags


class STVersionManager:
    """SillyTavern版本管理器"""

    def __init__(self):
        self.st_dir = os.path.join(os.getcwd(), "SillyTavern")

    def fetch_st_versions(self):
        """从本地Git仓库获取SillyTavern版本列表"""
        try:
            success, tags_data, message = get_st_tags(self.st_dir)
            if success:
                return {
                    'success': True,
                    'versions': tags_data.get('versions', {}),
                    'latest': tags_data.get('latest', ''),
                    'error': None
                }
            else:
                return {
                    'success': False,
                    'versions': {},
                    'latest': '',
                    'error': message
                }
        except Exception as e:
            return {
                'success': False,
                'versions': {},
                'latest': '',
                'error': f'获取版本列表失败: {str(e)}'
            }

    def update_remote_tags(self):
        """从远程仓库获取最新tags"""
        try:
            success, message = fetch_remote_tags(self.st_dir)
            return {'success': success, 'message': message}
        except Exception as e:
            return {'success': False, 'message': f'获取远程tags失败: {str(e)}'}

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

        def _version_sort_key(item):
            ver = item[0].lstrip('v')
            parts = []
            for p in ver.split('.'):
                try:
                    parts.append(int(p))
                except ValueError:
                    parts.append(0)
            return tuple(parts)

        sorted_versions = sorted(versions.items(), key=_version_sort_key, reverse=True)[:limit]

        for ver_str, ver_data in sorted_versions:
            commit = ver_data.get('commit', '')[:7]
            date_str = ver_data.get('date', '')
            is_latest = ver_str == latest_version

            # 转换日期格式
            try:
                if date_str:
                    dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    date_str = dt.strftime('%Y-%m-%d')
            except (ValueError, TypeError):
                pass

            latest_mark = " [最新]" if is_latest else ""
            formatted.append(f"  v{ver_str}{latest_mark} - {commit} ({date_str})")

        return formatted


if __name__ == "__main__":
    # 测试版本管理器
    manager = STVersionManager()

    print("=== 测试获取版本列表 ===")
    result = manager.fetch_st_versions()

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
