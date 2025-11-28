#!/usr/bin/env python3
"""
SillyTavern Data Sync for Termux
Termux-specific synchronization utilities and commands
"""

import os
import sys
import json
import subprocess
import argparse
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_client import SyncClient
from sync_server import SyncServer
from config import ConfigManager


class TermuxSyncManager:
    def __init__(self):
        """Initialize Termux sync manager"""
        self.config_manager = ConfigManager()
        self.config = self.config_manager.config

        # Define paths
        self.base_dir = os.path.expanduser("~/SillytavernLauncher")
        self.st_dir = os.path.join(self.base_dir, "SillyTavern")
        self.data_dir = os.path.join(self.st_dir, "data", "default-user")

        print("Termux 数据同步管理器已初始化")
        print(f"启动器目录: {self.base_dir}")
        print(f"SillyTavern 目录: {self.st_dir}")
        print(f"数据目录: {self.data_dir}")

    def detect_network_servers(self, timeout=3, port=9999):
        """Detect SillyTavern sync servers on local network"""
        print("正在扫描局域网中的 SillyTavern 同步服务器...")

        try:
            # Get local IP and network range
            import socket
            import threading
            from queue import Queue
            import requests
            import time

            # 更可靠地获取本地IP
            local_ip = self._get_local_ip()
            if not local_ip or local_ip == "127.0.0.1":
                print("无法获取有效的本地IP地址")
                print("请确保设备已连接到局域网")
                return []

            # Extract network segment
            ip_parts = local_ip.split('.')
            if len(ip_parts) != 4:
                print(f"无效的IP地址格式: {local_ip}")
                return []

            network_base = '.'.join(ip_parts[:3])
            last_octet = int(ip_parts[3])

            print(f"本地IP地址: {local_ip}")
            print(f"扫描网络段: {network_base}.0/24")
            print(f"扫描端口: {port}")

            result_queue = Queue()
            threads = []
            found_servers = []

            def check_ip(ip):
                """检查指定IP是否有同步服务器"""
                url = f"http://{ip}:{port}/health"
                try:
                    response = requests.get(url, timeout=timeout)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get('status') == 'healthy':
                            result_queue.put((ip, True, data))
                    else:
                        result_queue.put((ip, False, None))
                except Exception:
                    result_queue.put((ip, False, None))

            # 根据网络类型采用不同的扫描策略
            scan_targets = []

            if local_ip.startswith('192.168'):
                # 常用家庭网络，扫描优先级IP
                priority_ips = [1, 2, 254, last_octet-1, last_octet+1]  # 网关、常用设备、相邻IP
                normal_range = list(range(1, 255))

                # 优先扫描
                for i in priority_ips:
                    if 1 <= i <= 254 and i != last_octet:
                        scan_targets.append(f"{network_base}.{i}")

                # 添加其他IP到扫描列表（限制数量以提高速度）
                for i in normal_range:
                    if i not in priority_ips and i != last_octet:
                        scan_targets.append(f"{network_base}.{i}")
                        if len(scan_targets) >= 30:  # 限制扫描数量
                            break

            elif local_ip.startswith('10.'):
                # 企业网络，限制扫描范围
                # 只扫描当前子网段的部分IP
                for i in range(max(1, last_octet-10), min(254, last_octet+10)):
                    if i != last_octet:
                        scan_targets.append(f"{network_base}.{i}")

            elif local_ip.startswith('172'):
                # 172.16-31.x.x 网络
                if len(ip_parts) >= 2 and 16 <= int(ip_parts[1]) <= 31:
                    # 只扫描当前子网
                    for i in range(max(1, last_octet-5), min(254, last_octet+5)):
                        if i != last_octet:
                            scan_targets.append(f"{network_base}.{i}")

            else:
                # 其他网络类型，只扫描相邻的几个IP
                for i in range(max(1, last_octet-3), min(254, last_octet+3)):
                    if i != last_octet:
                        scan_targets.append(f"{network_base}.{i}")

            # 添加本地主机检测
            scan_targets.insert(0, "127.0.0.1")
            scan_targets.insert(1, local_ip)

            print(f"将扫描 {len(scan_targets)} 个IP地址...")

            # 启动扫描线程（限制并发数）
            max_threads = 10
            for i, ip in enumerate(scan_targets):
                thread = threading.Thread(target=check_ip, args=(ip,))
                threads.append(thread)
                thread.start()

                # 控制并发线程数量
                if (i + 1) % max_threads == 0:
                    time.sleep(0.1)

            # 等待所有线程完成
            for thread in threads:
                thread.join(timeout=timeout+1)

            # 收集结果
            while not result_queue.empty():
                ip, success, data = result_queue.get()
                if success:
                    found_servers.append((ip, data))

            # 显示结果
            if found_servers:
                print(f"\n发现 {len(found_servers)} 个 SillyTavern 同步服务器:")
                print("-" * 60)
                for i, (ip, data) in enumerate(found_servers, 1):
                    data_path = data.get('data_path', 'N/A')
                    timestamp = data.get('timestamp', 'N/A')
                    print(f"  {i}. {ip}:{port}")
                    print(f"     数据路径: {data_path}")
                    print(f"     状态时间: {timestamp}")
                print("-" * 60)

                return [(f"http://{ip}:{port}", data) for ip, data in found_servers]
            else:
                print(f"\n未发现端口 {port} 上的 SillyTavern 同步服务器")
                print("请确保:")
                print("  1. 目标设备已启动 SillyTavern 同步服务")
                print("  2. 设备在同一局域网内")
                print("  3. 防火墙允许端口访问")
                print("  4. 服务器使用的是默认端口 9999")
                return []

        except Exception as e:
            print(f"网络扫描失败: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _get_local_ip(self):
        """获取本地IP地址 - Termux环境优化版本"""
        import subprocess
        import re
        import socket

        # 方法1：使用ipconfig命令获取局域网IP（Termux最可靠）
        try:
            # Termux使用ipconfig命令
            result = subprocess.run(['ipconfig'], capture_output=True, text=True, timeout=10)
            output = result.stdout

            # 查找IPv4地址，排除127.0.0.1和169.254.x.x
            ip_pattern = r'IPv4 Address[ .]*: ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})'
            matches = re.findall(ip_pattern, output)

            # 过滤有效的局域网IP
            lan_ips = []
            for ip in matches:
                if (ip != '127.0.0.1' and
                    not ip.startswith('169.254.') and  # APIPA地址
                    not ip.startswith('255.') and
                    not ip.startswith('0.')):
                    lan_ips.append(ip)

            # 优先选择192.168.x.x和10.x.x.x网段
            for ip in lan_ips:
                if ip.startswith('192.168.') or ip.startswith('10.'):
                    return ip

            # 如果没有找到，返回第一个有效的局域网IP
            if lan_ips:
                return lan_ips[0]

        except Exception as e:
            print(f"ipconfig命令失败: {e}")

        # 方法2：回退到socket方法
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()

            # 验证IP地址格式并确保是局域网IP
            parts = local_ip.split('.')
            if (len(parts) == 4 and
                all(0 <= int(p) <= 255 for p in parts) and
                local_ip != "127.0.0.1" and
                (local_ip.startswith('192.168.') or
                 local_ip.startswith('10.') or
                 local_ip.startswith('172.'))):
                return local_ip
        except:
            pass

        # 最后回退
        return "127.0.0.1"

    def sync_from_detected_server(self, method='auto', backup=True):
        """Sync from detected server with interactive selection"""
        servers = self.detect_network_servers()

        if not servers:
            print("未发现可用的同步服务器")
            return False

        if len(servers) == 1:
            server_url, server_info = servers[0]
            print(f"使用发现的服务器: {server_url}")
        else:
            print("\n请选择同步服务器:")
            for i, (server_url, server_info) in enumerate(servers, 1):
                print(f"  {i}. {server_url} - {server_info.get('data_path', 'N/A')}")

            try:
                choice = int(input(f"请选择 [1-{len(servers)}]: ")) - 1
                if 0 <= choice < len(servers):
                    server_url, server_info = servers[choice]
                else:
                    print("无效选择")
                    return False
            except ValueError:
                print("无效输入")
                return False

        # Perform sync
        try:
            client = SyncClient(server_url, self.data_dir)
            success = client.sync(prefer_zip=(method == 'auto' or method == 'zip'), backup=backup)
            return success
        except Exception as e:
            print(f"同步失败: {e}")
            return False

    def start_sync_server(self, port=5000, host='0.0.0.0'):
        """Start sync server on Termux"""
        print("启动 Termux 数据同步服务...")

        if not os.path.exists(self.data_dir):
            print(f"错误: 数据目录不存在: {self.data_dir}")
            print("请先安装并运行 SillyTavern")
            return False

        try:
            # Initialize sync server
            sync_server = SyncServer(
                data_path=self.data_dir,
                port=port,
                host=host
            )

            # Save configuration
            self.config_manager.set("sync.enabled", True)
            self.config_manager.set("sync.port", port)
            self.config_manager.set("sync.host", host)
            self.config_manager.save_config()

            # Start server
            sync_server.start(block=False)

            # Get local IP
            import socket
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()

            print(f"数据同步服务已启动!")
            print(f"服务器地址: http://{local_ip}:{port}")
            print(f"本地地址: http://localhost:{port}")
            print(f"数据路径: {self.data_dir}")

            # Display commands for other devices
            print(f"\n其他设备可以使用以下命令同步:")
            print(f"  st sync from --server-url http://{local_ip}:{port}")
            print(f"  python sync_termux.py detect-and-sync --server-url http://{local_ip}:{port}")

            return True

        except Exception as e:
            print(f"启动同步服务器失败: {e}")
            return False

    def stop_sync_server(self):
        """Stop sync server"""
        self.config_manager.set("sync.enabled", False)
        self.config_manager.save_config()
        print("数据同步服务已停止 (需要重启启动器)")

    def sync_from_custom_server(self, server_url, method='auto', backup=True):
        """Sync from custom server URL"""
        print(f"从自定义服务器同步: {server_url}")

        try:
            client = SyncClient(server_url, self.data_dir)
            success = client.sync(prefer_zip=(method == 'auto' or method == 'zip'), backup=backup)
            return success
        except Exception as e:
            print(f"同步失败: {e}")
            return False

    def show_sync_status(self):
        """Show current sync status"""
        print("数据同步状态:")

        sync_enabled = self.config_manager.get("sync.enabled", False)
        sync_port = self.config_manager.get("sync.port", 5000)
        sync_host = self.config_manager.get("sync.host", "0.0.0.0")

        print(f"  同步服务状态: {'启用' if sync_enabled else '禁用'}")
        print(f"  监听主机: {sync_host}")
        print(f"  监听端口: {sync_port}")
        print(f"  数据目录: {self.data_dir}")

        if sync_enabled:
            try:
                import socket
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
                s.close()
                print(f"  客户端地址: http://{local_ip}:{sync_port}")
            except:
                print(f"  客户端地址: http://localhost:{sync_port}")

        # Check data directory size and file count
        if os.path.exists(self.data_dir):
            total_size = 0
            file_count = 0
            for root, dirs, files in os.walk(self.data_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    try:
                        total_size += os.path.getsize(file_path)
                        file_count += 1
                    except:
                        continue

            print(f"  数据大小: {self._format_size(total_size)}")
            print(f"  文件数量: {file_count}")
        else:
            print(f"  数据目录: 不存在")

    def _format_size(self, size_bytes):
        """Format file size in human readable format"""
        if size_bytes == 0:
            return "0B"

        size_names = ["B", "KB", "MB", "GB"]
        i = 0
        while size_bytes >= 1024 and i < len(size_names) - 1:
            size_bytes /= 1024.0
            i += 1

        return f"{size_bytes:.1f}{size_names[i]}"


def main():
    """Main function for Termux sync utilities"""
    parser = argparse.ArgumentParser(description='SillyTavern Termux 数据同步工具')
    subparsers = parser.add_subparsers(dest='command', help='可用命令')

    # Detect servers command
    detect_parser = subparsers.add_parser('detect', help='检测局域网中的同步服务器')

    # Detect and sync command
    detect_sync_parser = subparsers.add_parser('detect-and-sync', help='检测并从服务器同步数据')
    detect_sync_parser.add_argument('--method', choices=['auto', 'zip', 'incremental'],
                                  default='auto', help='同步方法')
    detect_sync_parser.add_argument('--no-backup', action='store_true', help='同步时不备份现有数据')

    # Start server command
    start_parser = subparsers.add_parser('start', help='启动同步服务器')
    start_parser.add_argument('--port', type=int, default=5000, help='服务器端口')
    start_parser.add_argument('--host', default='0.0.0.0', help='服务器主机地址')

    # Stop server command
    subparsers.add_parser('stop', help='停止同步服务器')

    # Sync from custom server
    sync_parser = subparsers.add_parser('sync', help='从指定服务器同步数据')
    sync_parser.add_argument('server_url', help='服务器URL')
    sync_parser.add_argument('--method', choices=['auto', 'zip', 'incremental'],
                           default='auto', help='同步方法')
    sync_parser.add_argument('--no-backup', action='store_true', help='同步时不备份现有数据')

    # Status command
    subparsers.add_parser('status', help='显示同步状态')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    try:
        manager = TermuxSyncManager()

        if args.command == 'detect':
            servers = manager.detect_network_servers()
            return 0 if servers else 1

        elif args.command == 'detect-and-sync':
            success = manager.sync_from_detected_server(
                args.method, not args.no_backup
            )
            return 0 if success else 1

        elif args.command == 'start':
            success = manager.start_sync_server(args.port, args.host)
            return 0 if success else 1

        elif args.command == 'stop':
            manager.stop_sync_server()
            return 0

        elif args.command == 'sync':
            success = manager.sync_from_custom_server(
                args.server_url, args.method, not args.no_backup
            )
            return 0 if success else 1

        elif args.command == 'status':
            manager.show_sync_status()
            return 0

        return 0

    except KeyboardInterrupt:
        print("\n程序被用户中断")
        return 0
    except Exception as e:
        print(f"程序运行出错: {e}")
        return 1


if __name__ == "__main__":
    exit(main())