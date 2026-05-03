"""
Network utilities for SillyTavern Launcher (Termux)
IP address detection and network-related functions
"""

import time
import subprocess
import re
import socket
from typing import Optional


class NetworkManager:
    """Network utilities manager for Termux/Linux environment"""

    def __init__(self, cache_duration: int = 300):
        self._cached_local_ip = None
        self._last_ip_check_time = 0
        self._ip_cache_duration = cache_duration

    def get_local_ip(self) -> Optional[str]:
        """
        获取本机局域网IP地址（带缓存，优先选择物理网卡）

        Returns:
            str: 本机局域网IP地址，如果获取失败则返回None
        """
        current_time = time.time()

        if (self._cached_local_ip and
            current_time - self._last_ip_check_time < self._ip_cache_duration):
            return self._cached_local_ip

        best_ip = None

        # 方法1: 使用 ifconfig 命令 (Termux/Linux)
        best_ip = self._get_ip_from_ifconfig()

        # 方法2: 使用 ip addr 命令
        if not best_ip:
            best_ip = self._get_ip_from_ip_addr()

        # 方法3: 备用 socket 方法
        if not best_ip:
            best_ip = self._fallback_get_local_ip()

        if best_ip:
            self._cached_local_ip = best_ip
            self._last_ip_check_time = current_time

        return best_ip

    def _get_ip_from_ifconfig(self) -> Optional[str]:
        """通过 ifconfig 命令获取IP地址"""
        try:
            result = subprocess.run(
                ['ifconfig'], capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return None

            return self._parse_ifconfig_output(result.stdout)
        except Exception:
            return None

    def _get_ip_from_ip_addr(self) -> Optional[str]:
        """通过 ip addr 命令获取IP地址"""
        try:
            result = subprocess.run(
                ['ip', 'addr'], capture_output=True, text=True, timeout=5
            )
            if result.returncode != 0:
                return None

            return self._parse_ip_addr_output(result.stdout)
        except Exception:
            return None

    def _parse_ifconfig_output(self, output: str) -> Optional[str]:
        """解析 ifconfig 输出，提取适配器信息和IP地址"""
        adapters = []
        current_adapter = None
        adapter_type = 'other'
        priority = 25

        for line in output.split('\n'):
            # 检测适配器名称行（不以空格开头，包含 flags 或 : 结尾）
            adapter_match = re.match(r'^(\S+)', line)
            if adapter_match and not line.startswith(' ') and not line.startswith('\t'):
                current_adapter = adapter_match.group(1)
                adapter_type, priority = self._classify_adapter(current_adapter)
                continue

            # 查找 inet 地址 (IPv4)
            inet_match = re.search(r'inet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', line)
            if inet_match and current_adapter:
                ip = inet_match.group(1)
                if self._is_valid_ip(ip):
                    adapters.append({
                        'ip': ip,
                        'name': current_adapter,
                        'type': adapter_type,
                        'priority': priority
                    })

        if not adapters:
            return None

        best = min(adapters, key=lambda x: (
            x['priority'],
            self._get_ip_priority(x['ip'])
        ))
        print(f"通过 ifconfig 获取IP: {best['ip']} ({best['name']})")
        return best['ip']

    def _parse_ip_addr_output(self, output: str) -> Optional[str]:
        """解析 ip addr 输出，提取适配器信息和IP地址"""
        adapters = []
        current_adapter = None
        adapter_type = 'other'
        priority = 25

        for line in output.split('\n'):
            # 检测适配器名称行: "2: eth0: <BROADCAST,..."
            adapter_match = re.match(r'^\d+:\s+(\S+):', line)
            if adapter_match:
                current_adapter = adapter_match.group(1)
                adapter_type, priority = self._classify_adapter(current_adapter)
                continue

            # 查找 inet 地址
            inet_match = re.search(r'inet\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/\d+', line)
            if inet_match and current_adapter:
                ip = inet_match.group(1)
                if self._is_valid_ip(ip):
                    adapters.append({
                        'ip': ip,
                        'name': current_adapter,
                        'type': adapter_type,
                        'priority': priority
                    })

        if not adapters:
            return None

        best = min(adapters, key=lambda x: (
            x['priority'],
            self._get_ip_priority(x['ip'])
        ))
        print(f"通过 ip addr 获取IP: {best['ip']} ({best['name']})")
        return best['ip']

    def _classify_adapter(self, adapter_name: str) -> tuple:
        """
        判断适配器类型和优先级

        Returns:
            tuple: (适配器类型, 优先级数值)
        """
        name_lower = adapter_name.lower()

        # 虚拟机相关关键词（最低优先级）
        vm_keywords = [
            'vmware', 'virtualbox', 'virtual', 'vbox', 'vethernet',
            'docker', 'br-', 'virbr', 'vnc', 'tap'
        ]
        # VPN相关关键词（次低优先级）
        vpn_keywords = [
            'vpn', 'tun', 'ppp', 'pptp', 'l2tp',
            'openvpn', 'wireguard', 'nordvpn', 'expressvpn'
        ]
        # 物理网卡相关关键词（高优先级）
        physical_keywords = [
            'eth', 'wlan', 'wifi', 'wl', 'enp', 'wlp',
            'realtek', 'intel', 'broadcom', 'qualcomm',
            'atheros', '802.11'
        ]

        for keyword in vm_keywords:
            if keyword in name_lower:
                return ('vm', 30)

        for keyword in vpn_keywords:
            if keyword in name_lower:
                return ('vpn', 20)

        for keyword in physical_keywords:
            if keyword in name_lower:
                return ('physical', 10)

        # lo 回环接口
        if name_lower == 'lo':
            return ('loopback', 99)

        return ('other', 25)

    def _fallback_get_local_ip(self) -> Optional[str]:
        """备用方法获取本机IP地址"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(3)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()

            if self._is_valid_ip(local_ip):
                print(f"通过备用方法获取IP: {local_ip}")
                return local_ip
        except Exception:
            pass

        return None

    def _is_valid_ip(self, ip: str) -> bool:
        """验证IP地址格式是否有效（排除回环和APIPA）"""
        try:
            parts = ip.split('.')
            if len(parts) != 4:
                return False
            for part in parts:
                num = int(part)
                if num < 0 or num > 255:
                    return False
            if ip.startswith("127.") or ip.startswith("169.254."):
                return False
            return True
        except (ValueError, AttributeError):
            return False

    def _get_ip_priority(self, ip: str) -> int:
        """获取IP地址的优先级，数值越小优先级越高"""
        try:
            parts = ip.split('.')
            if len(parts) != 4:
                return 999
            first = int(parts[0])
            second = int(parts[1])
            if first == 192 and second == 168:
                return 1
            elif first == 10:
                return 2
            elif first == 172 and 16 <= second <= 31:
                return 3
            elif self._is_valid_ip(ip):
                return 4
            return 999
        except (ValueError, AttributeError, IndexError):
            return 999


# Global singleton instance
_global_network_manager = None


def get_network_manager() -> NetworkManager:
    """Get the global NetworkManager instance (singleton pattern)"""
    global _global_network_manager
    if _global_network_manager is None:
        _global_network_manager = NetworkManager()
    return _global_network_manager


def get_local_ip() -> Optional[str]:
    """Convenience function to get local IP using the global NetworkManager"""
    return get_network_manager().get_local_ip()
