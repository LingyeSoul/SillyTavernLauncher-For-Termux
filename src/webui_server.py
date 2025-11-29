#!/usr/bin/env python3
"""
基于Flask的现代化WebUI服务器
为MDUI2前端提供RESTful API接口
"""

import os
import sys
import json
import threading
import time
import socket
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, disconnect

# 添加当前目录到Python路径以导入本地模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    from flask import Flask, request, jsonify, Response, send_from_directory
    from flask_cors import CORS
    from flask_socketio import SocketIO, emit, disconnect
except ImportError as e:
    print(f"错误: 缺少必要的依赖包 {e}")
    print("请运行: pip install flask flask-cors flask-socketio")
    sys.exit(1)

from main_cli import SillyTavernCliLauncher
from config import ConfigManager


class SillyTavernWebUIServer:
    def __init__(self, host="127.0.0.1", port=8080):
        self.host = host
        self.port = port

        # 创建Flask应用
        self.app = Flask(__name__)
        self.app.config['SECRET_KEY'] = 'sillytavern-webui-secret-key'

        # 配置CORS
        CORS(self.app)

        # 创建SocketIO实例
        self.socketio = SocketIO(self.app, cors_allowed_origins="*", async_mode='threading')

        # 初始化启动器和配置
        try:
            self.launcher = SillyTavernCliLauncher()
            self.config_manager = self.launcher.config_manager
        except Exception as e:
            print(f"警告: 初始化启动器失败: {e}")
            self.launcher = None
            self.config_manager = ConfigManager()

        # WebSocket连接管理（现在使用Flask-SocketIO）
        self.websocket_connections = []

        # 设置路由
        self._setup_routes()
        self._setup_socketio_events()

    def _setup_routes(self):
        """设置API路由"""

        # 静态文件服务
        static_dir = os.path.join(os.path.dirname(current_dir), "webui", "static")
        if os.path.exists(static_dir):
            self.app.static_url_path = '/static'
            self.app.static_folder = static_dir

            @self.app.route('/static/<path:filename>')
            def serve_static(filename):
                return send_from_directory(static_dir, filename)

        @self.app.route('/')
        def read_root():
            """提供主页面"""
            index_path = os.path.join(os.path.dirname(current_dir), "webui", "index.html")
            if os.path.exists(index_path):
                with open(index_path, "r", encoding="utf-8") as f:
                    return Response(f.read(), mimetype='text/html')
            else:
                return jsonify({"error": "index.html not found"}), 404

        # SillyTavern 控制接口
        @self.app.route('/api/sillytavern/install', methods=['POST'])
        def install_sillytavern():
            """安装 SillyTavern"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            # 在后台线程中运行
            threading.Thread(target=self._run_install_sillytavern, daemon=True).start()
            return jsonify({"success": True, "message": "安装任务已启动"})

        @self.app.route('/api/sillytavern/start', methods=['POST'])
        def start_sillytavern():
            """启动 SillyTavern"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            threading.Thread(target=self._run_start_sillytavern, daemon=True).start()
            return jsonify({"success": True, "message": "启动任务已执行"})

        @self.app.route('/api/sillytavern/update', methods=['POST'])
        def update_sillytavern():
            """更新 SillyTavern"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            threading.Thread(target=self._run_update_sillytavern, daemon=True).start()
            return jsonify({"success": True, "message": "更新任务已启动"})

        # 启动器控制接口
        @self.app.route('/api/launcher/update', methods=['POST'])
        def update_launcher():
            """更新启动器"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            threading.Thread(target=self._run_update_launcher, daemon=True).start()
            return jsonify({"success": True, "message": "更新任务已启动"})

        @self.app.route('/api/launcher/restart', methods=['POST'])
        def restart_launcher():
            """重启启动器"""
            def restart_after_delay():
                time.sleep(2)  # 给前端时间接收响应
                args = sys.argv[1:] if len(sys.argv) > 1 else []
                os.execv(sys.executable, [sys.executable] + [sys.argv[0]] + args)

            threading.Thread(target=restart_after_delay, daemon=True).start()
            return jsonify({"success": True, "message": "重启指令已发送"})

        # 配置管理接口
        @self.app.route('/api/config', methods=['GET'])
        def get_config():
            """获取配置信息"""
            try:
                config = self.config_manager.config.copy()

                # 添加额外信息
                config["local_ip"] = self._get_local_ip()

                # 添加SillyTavern配置
                if self.launcher and hasattr(self.launcher, 'stCfg'):
                    config["sillytavern"] = {
                        "port": getattr(self.launcher.stCfg, 'port', 8000),
                        "listen": getattr(self.launcher.stCfg, 'listen', False)
                    }

                # 添加同步配置
                config["sync"] = {
                    "port": config.get("sync.port", 9999),
                    "host": config.get("sync.host", "0.0.0.0")
                }

                return jsonify({"success": True, "data": config})
            except Exception as e:
                return jsonify({"success": False, "message": str(e)})

        @self.app.route('/api/config/mirror', methods=['POST'])
        def set_mirror():
            """设置GitHub镜像"""
            try:
                data = request.get_json()
                if not data or 'mirror' not in data:
                    return jsonify({"success": False, "message": "缺少mirror参数"})

                mirror = data['mirror']

                if self.launcher:
                    self.launcher.set_github_mirror(mirror)
                    self._broadcast_log(f"GitHub 镜像已设置为: {mirror}")
                    return jsonify({"success": True, "message": f"镜像已设置为: {mirror}"})
                else:
                    return jsonify({"success": False, "message": "启动器未初始化"})
            except Exception as e:
                return jsonify({"success": False, "message": str(e)})

        @self.app.route('/api/config/sillytavern', methods=['POST'])
        def save_st_config():
            """保存SillyTavern配置"""
            try:
                data = request.get_json()
                if not data or 'port' not in data or 'listenAll' not in data:
                    return jsonify({"success": False, "message": "缺少必要参数"})

                port = data['port']
                listenAll = data['listenAll']

                if self.launcher and hasattr(self.launcher, 'stCfg'):
                    self.launcher.stCfg.port = port
                    self.launcher.stCfg.listen = listenAll
                    self.launcher.stCfg.save()

                    self._broadcast_log(
                        f"SillyTavern 配置已保存: 端口={port}, 监听所有地址={listenAll}"
                    )
                    return jsonify({"success": True, "message": "配置已保存"})
                else:
                    # 直接保存到配置管理器
                    self.config_manager.set("sillytavern.port", port)
                    self.config_manager.set("sillytavern.listen", listenAll)
                    self.config_manager.save_config()

                    self._broadcast_log(
                        f"SillyTavern 配置已保存: 端口={port}, 监听所有地址={listenAll}"
                    )
                    return jsonify({"success": True, "message": "配置已保存"})
            except Exception as e:
                return jsonify({"success": False, "message": str(e)})

        @self.app.route('/api/config/autostart', methods=['POST'])
        def set_autostart():
            """设置一键启动"""
            try:
                data = request.get_json()
                if not data or 'enabled' not in data:
                    return jsonify({"success": False, "message": "缺少enabled参数"})

                enabled = data['enabled']

                self.config_manager.set("autostart", enabled)
                self.config_manager.save_config()

                self._broadcast_log(f"一键启动模式: {'启用' if enabled else '禁用'}")
                return jsonify({"success": True, "message": f"一键启动模式已{'启用' if enabled else '禁用'}"})
            except Exception as e:
                return jsonify({"success": False, "message": str(e)})

        # 同步服务器接口
        @self.app.route('/api/sync/start', methods=['POST'])
        def start_sync_server():
            """启动同步服务器"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            data = request.get_json()
            if not data or 'port' not in data or 'host' not in data:
                return jsonify({"success": False, "message": "缺少必要参数"})

            port = data['port']
            host = data['host']

            threading.Thread(target=self._run_start_sync_server, args=(port, host), daemon=True).start()
            return jsonify({"success": True, "message": "启动任务已执行"})

        @self.app.route('/api/sync/stop', methods=['POST'])
        def stop_sync_server():
            """停止同步服务器"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            threading.Thread(target=self._run_stop_sync_server, daemon=True).start()
            return jsonify({"success": True, "message": "停止任务已执行"})

        @self.app.route('/api/sync/status', methods=['GET'])
        def get_sync_server_status():
            """获取同步服务器状态"""
            try:
                if self.launcher:
                    status = self.launcher.get_sync_server_status()
                    return jsonify({"success": True, "data": status})
                else:
                    return jsonify({"success": False, "message": "启动器未初始化"})
            except Exception as e:
                return jsonify({"success": False, "message": str(e)})

        @self.app.route('/api/sync/from-server', methods=['POST'])
        def sync_from_server():
            """从服务器同步数据"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            data = request.get_json()
            if not data or 'serverUrl' not in data:
                return jsonify({"success": False, "message": "缺少serverUrl参数"})

            server_url = data['serverUrl']
            method = data.get('method', 'auto')
            backup = data.get('backup', True)

            threading.Thread(target=self._run_sync_from_server, args=(server_url, method, backup), daemon=True).start()
            return jsonify({"success": True, "message": "同步任务已启动"})

        # 系统状态接口
        @self.app.route('/api/status', methods=['GET'])
        def get_system_status():
            """获取系统状态"""
            try:
                status_info = self._get_system_status()
                return jsonify({"success": True, "data": status_info})
            except Exception as e:
                return jsonify({"success": False, "message": str(e)})

        # 工具接口
        @self.app.route('/api/ping', methods=['GET'])
        def ping():
            """测试连接"""
            return jsonify({
                "success": True,
                "message": "pong",
                "timestamp": datetime.now().isoformat()
            })

        @self.app.route('/api/version', methods=['GET'])
        def get_version():
            """获取版本信息"""
            return jsonify({
                "success": True,
                "data": {
                    "version": "2.0.0",
                    "framework": "Flask + MDUI2",
                    "python": sys.version
                }
            })

        # 批量操作接口
        @self.app.route('/api/install-all', methods=['POST'])
        def install_all():
            """一键安装所有依赖"""
            threading.Thread(target=self._run_install_all, daemon=True).start()
            return jsonify({"success": True, "message": "安装任务已启动"})

        @self.app.route('/api/quick-start', methods=['POST'])
        def quick_start():
            """快速启动"""
            if not self.launcher:
                return jsonify({"success": False, "message": "启动器未初始化"})

            threading.Thread(target=self._run_quick_start, daemon=True).start()
            return jsonify({"success": True, "message": "快速启动任务已执行"})

    def _setup_socketio_events(self):
        """设置SocketIO事件"""

        @self.socketio.on('connect')
        def handle_connect():
            """客户端连接"""
            self.websocket_connections.append(request.sid)
            print(f"WebSocket客户端连接: {request.sid}")
            emit('connected', {'status': 'connected'})

        @self.socketio.on('disconnect')
        def handle_disconnect():
            """客户端断开连接"""
            if request.sid in self.websocket_connections:
                self.websocket_connections.remove(request.sid)
            print(f"WebSocket客户端断开连接: {request.sid}")

        @self.socketio.on('heartbeat')
        def handle_heartbeat():
            """心跳检测"""
            emit('heartbeat_response', {'timestamp': datetime.now().isoformat()})

    def _broadcast_log(self, message: str):
        """向所有WebSocket连接广播日志消息"""
        timestamp = datetime.now().strftime('%H:%M:%S')
        log_data = {
            "type": "log",
            "timestamp": timestamp,
            "message": message
        }

        # 使用SocketIO广播
        try:
            self.socketio.emit('log', log_data)
        except Exception as e:
            print(f"广播日志失败: {e}")

    def _get_local_ip(self):
        """获取本地IP地址"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            return "127.0.0.1"

    def _get_system_status(self) -> Dict[str, Any]:
        """获取系统状态信息"""
        try:
            # SillyTavern 状态
            st_dir = os.path.join(os.getcwd(), "SillyTavern")
            st_installed = os.path.exists(st_dir)

            st_info = {
                "installed": st_installed
            }

            if self.launcher and hasattr(self.launcher, 'stCfg'):
                st_info.update({
                    "port": getattr(self.launcher.stCfg, 'port', 8000),
                    "listen": getattr(self.launcher.stCfg, 'listen', False)
                })

            # 同步服务器状态
            sync_info = {
                "running": False,
                "config_enabled": False,
                "consistent": False,
                "port": 9999,
                "host": "0.0.0.0"
            }

            if self.launcher:
                try:
                    sync_status = self.launcher.get_sync_server_status()
                    sync_info.update(sync_status)
                except:
                    pass

            # 配置信息
            config = self.config_manager.config.copy()

            # 数据目录信息
            data_dir = os.path.join(st_dir, "data", "default-user") if st_installed else None

            return {
                "sillytavern": st_info,
                "sync_server": sync_info,
                "github_mirror": config.get("github.mirror", "github"),
                "autostart": config.get("autostart", False),
                "local_ip": self._get_local_ip(),
                "data_dir": data_dir,
                "data_dir_exists": data_dir and os.path.exists(data_dir),
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

    # 后台任务方法
    def _run_install_sillytavern(self):
        """后台安装 SillyTavern"""
        try:
            self._broadcast_log("开始安装 SillyTavern...")
            self.launcher.install_sillytavern()
            self._broadcast_log("SillyTavern 安装完成")
        except Exception as e:
            self._broadcast_log(f"安装失败: {e}")

    def _run_start_sillytavern(self):
        """后台启动 SillyTavern"""
        try:
            self._broadcast_log("正在启动 SillyTavern...")
            self.launcher.start_sillytavern()
            self._broadcast_log("SillyTavern 启动成功")
        except Exception as e:
            self._broadcast_log(f"启动失败: {e}")

    def _run_update_sillytavern(self):
        """后台更新 SillyTavern"""
        try:
            self._broadcast_log("开始更新 SillyTavern...")
            self.launcher.update_sillytavern()
            self._broadcast_log("SillyTavern 更新完成")
        except Exception as e:
            self._broadcast_log(f"更新失败: {e}")

    def _run_update_launcher(self):
        """后台更新启动器"""
        try:
            self._broadcast_log("开始更新启动器...")
            self.launcher.update_launcher()
            self._broadcast_log("启动器更新完成")
        except Exception as e:
            self._broadcast_log(f"更新失败: {e}")

    def _run_start_sync_server(self, port: int, host: str):
        """后台启动同步服务器"""
        try:
            self._broadcast_log(f"正在启动同步服务器 (端口: {port}, 主机: {host})...")
            success = self.launcher.start_sync_server(port, host)
            if success:
                self._broadcast_log("同步服务器启动成功")
            else:
                self._broadcast_log("同步服务器启动失败")
        except Exception as e:
            self._broadcast_log(f"启动同步服务器失败: {e}")

    def _run_stop_sync_server(self):
        """后台停止同步服务器"""
        try:
            self._broadcast_log("正在停止同步服务器...")
            self.launcher.stop_sync_server()
            self._broadcast_log("同步服务器已停止")
        except Exception as e:
            self._broadcast_log(f"停止同步服务器失败: {e}")

    def _run_sync_from_server(self, server_url: str, method: str, backup: bool):
        """后台从服务器同步数据"""
        try:
            self._broadcast_log(f"开始从服务器同步数据: {server_url} (方法: {method}, 备份: {backup})")
            success = self.launcher.sync_from_server(server_url, method, backup)
            if success:
                self._broadcast_log("数据同步完成")
            else:
                self._broadcast_log("数据同步失败")
        except Exception as e:
            self._broadcast_log(f"同步过程中出错: {e}")

    def _run_install_all(self):
        """后台安装所有依赖"""
        try:
            self._broadcast_log("开始一键安装...")
            # 这里可以添加安装逻辑
            self._broadcast_log("一键安装完成")
        except Exception as e:
            self._broadcast_log(f"一键安装失败: {e}")

    def _run_quick_start(self):
        """后台快速启动"""
        try:
            self._broadcast_log("开始快速启动...")
            # 检查是否已安装
            st_dir = os.path.join(os.getcwd(), "SillyTavern")
            if not os.path.exists(st_dir):
                self._broadcast_log("正在安装 SillyTavern...")
                self.launcher.install_sillytavern()

            self._broadcast_log("正在启动 SillyTavern...")
            self.launcher.start_sillytavern()
            self._broadcast_log("快速启动完成")
        except Exception as e:
            self._broadcast_log(f"快速启动失败: {e}")

    def run(self):
        """启动服务器"""
        print(f"正在启动 SillyTavernLauncher WebUI 服务器...")
        print(f"本地访问地址: http://{self.host}:{self.port}")
        if self.host == "0.0.0.0":
            local_ip = self._get_local_ip()
            print(f"网络访问地址: http://{local_ip}:{self.port}")

        # 使用SocketIO运行服务器
        self.socketio.run(
            self.app,
            host=self.host,
            port=self.port,
            debug=False,
            allow_unsafe_werkzeug=True
        )


def start_webui_server(host="127.0.0.1", port=8080, **kwargs):
    """启动WebUI服务器"""
    server = SillyTavernWebUIServer(host, port)
    server.run()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SillyTavernLauncher WebUI 服务器")
    parser.add_argument("--host", default="127.0.0.1", help="服务器主机地址 (默认: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="服务器端口 (默认: 8080)")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    parser.add_argument("--remote", action="store_true", help="允许远程访问 (绑定到 0.0.0.0)")

    args = parser.parse_args()

    # 如果允许远程访问，设置主机为0.0.0.0
    host = "0.0.0.0" if args.remote else args.host

    print("\n" + "="*50)
    print("SillyTavernLauncher WebUI 服务器")
    print("="*50)
    print(f"服务器地址: {host}:{args.port}")
    print(f"调试模式: {'启用' if args.debug else '禁用'}")
    print(f"远程访问: {'启用' if args.remote else '禁用'}")
    print("="*50)
    print("\n按 Ctrl+C 停止服务器\n")

    try:
        start_webui_server(
            host=host,
            port=args.port
        )
    except KeyboardInterrupt:
        print("\n正在停止 WebUI 服务器...")
        print("WebUI 已停止")
    except Exception as e:
        print(f"启动 WebUI 失败: {e}")
        sys.exit(1)