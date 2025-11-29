#!/usr/bin/env python3
"""
现代化的 SillyTavern WebUI 启动脚本
使用 FastAPI + MDUI2 架构
"""

import sys
import os
import argparse
import threading
import time
import webbrowser
import socket

# 添加当前目录到Python路径以导入本地模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)


def open_browser(url, delay=2.0):
    """延迟打开浏览器"""
    time.sleep(delay)
    try:
        webbrowser.open(url)
        print(f"已在浏览器中打开: {url}")
    except Exception as e:
        print(f"无法自动打开浏览器: {e}")
        print(f"请手动访问: {url}")


def get_local_ip():
    """获取本地IP地址"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return "127.0.0.1"


def main():
    parser = argparse.ArgumentParser(description="SillyTavern 现代化 WebUI 启动器")
    parser.add_argument("--host", default="127.0.0.1", help="服务器主机地址 (默认: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="服务器端口 (默认: 8080)")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    parser.add_argument("--remote", action="store_true", help="允许远程访问 (绑定到 0.0.0.0)")

    args = parser.parse_args()

    # 检查依赖
    try:
        from webui_server import start_webui_server
    except ImportError as e:
        print(f"错误: 缺少必要的依赖包 {e}")
        print("请运行以下命令安装依赖:")
        print("pip install fastapi uvicorn pydantic websockets")
        sys.exit(1)

    # 如果允许远程访问，设置主机为0.0.0.0
    host = "0.0.0.0" if args.remote else args.host

    # 构建访问URL
    if host == "0.0.0.0":
        # 对于远程访问，显示本地IP
        local_ip = get_local_ip()
        url = f"http://{local_ip}:{args.port}"
        print(f"远程访问已启用")
        print(f"本地访问地址: http://127.0.0.1:{args.port}")
        print(f"网络访问地址: {url}")
    else:
        url = f"http://{host}:{args.port}"
        print(f"本地访问地址: {url}")

    print("\n" + "="*60)
    print("SillyTavern 现代化 WebUI 启动器")
    print("="*60)
    print(f"服务器地址: {host}:{args.port}")
    print(f"访问URL: {url}")
    print(f"调试模式: {'启用' if args.debug else '禁用'}")
    print(f"自动打开浏览器: {'否' if args.no_browser else '是'}")
    print(f"远程访问: {'启用' if args.remote else '禁用'}")
    print("="*60)
    print("\n特性:")
    print("• 基于 FastAPI + MDUI2 的现代化界面")
    print("• 响应式设计，支持移动设备")
    print("• 实时WebSocket日志更新")
    print("• RESTful API 接口")
    print("• Material Design 风格")
    print("\n按 Ctrl+C 停止服务器\n")

    # 如果不自动打开浏览器，在后台线程中打开
    if not args.no_browser:
        browser_thread = threading.Thread(
            target=open_browser,
            args=(url, 2.0),
            daemon=True
        )
        browser_thread.start()

    try:
        print(f"正在启动现代化 WebUI 服务器...")
        # 设置启动参数
        server_kwargs = {
            'host': host,
            'port': args.port
        }

        start_webui_server(**server_kwargs)
    except KeyboardInterrupt:
        print("\n正在停止现代化 WebUI 服务器...")
        print("WebUI 已停止")
    except Exception as e:
        print(f"启动 WebUI 失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()