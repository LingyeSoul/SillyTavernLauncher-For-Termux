#!/usr/bin/env python3
"""
SillyTavern WebUI 独立启动脚本
可以直接启动WebUI，不通过主菜单
"""

import sys
import os
import argparse

# 添加当前目录到Python路径以导入本地模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    from webui import start_webui, SillyTavernWebUI
    from remi import start
    import webbrowser
    import time
    import threading
except ImportError as e:
    print("错误: 缺少必要的依赖库")
    print(f"具体错误: {e}")
    print("请运行: pip install remi")
    sys.exit(1)


def open_browser(url, delay=1.0):
    """延迟打开浏览器"""
    time.sleep(delay)
    try:
        webbrowser.open(url)
        print(f"已在浏览器中打开: {url}")
    except Exception as e:
        print(f"无法自动打开浏览器: {e}")
        print(f"请手动访问: {url}")


def main():
    parser = argparse.ArgumentParser(description="SillyTavern WebUI 独立启动器")
    parser.add_argument("--host", default="127.0.0.1", help="服务器主机地址 (默认: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="服务器端口 (默认: 8080)")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")
    parser.add_argument("--remote", action="store_true", help="允许远程访问 (绑定到 0.0.0.0)")

    args = parser.parse_args()

    # 如果允许远程访问，设置主机为0.0.0.0
    host = "0.0.0.0" if args.remote else args.host

    # 构建访问URL
    if host == "0.0.0.0":
        # 对于远程访问，显示本地IP
        import socket
        try:
            # 获取本地IP地址
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            url = f"http://{local_ip}:{args.port}"
            print(f"远程访问已启用")
            print(f"本地访问地址: http://127.0.0.1:{args.port}")
            print(f"网络访问地址: {url}")
        except Exception:
            url = f"http://127.0.0.1:{args.port}"
            print(f"无法获取本地IP，使用: {url}")
    else:
        url = f"http://{host}:{args.port}"
        print(f"本地访问地址: {url}")

    print("\n" + "="*50)
    print("SillyTavern WebUI 启动器")
    print("="*50)
    print(f"服务器地址: {host}:{args.port}")
    print(f"访问URL: {url}")
    print(f"调试模式: {'启用' if args.debug else '禁用'}")
    print(f"自动打开浏览器: {'否' if args.no_browser else '是'}")
    print("="*50)
    print("\n按 Ctrl+C 停止服务器\n")

    # 设置启动参数
    start_kwargs = {
        'address': host,
        'port': args.port,
        'multiple_instance': False,
        'enable_file_cache': not args.debug,
        'start_browser': False  # 手动控制浏览器打开
    }

    # 如果不自动打开浏览器，在后台线程中打开
    if not args.no_browser:
        browser_thread = threading.Thread(
            target=open_browser,
            args=(url, 2.0),
            daemon=True
        )
        browser_thread.start()

    try:
        print(f"正在启动 WebUI 服务器...")
        start(
            SillyTavernWebUI,
            **start_kwargs
        )
    except KeyboardInterrupt:
        print("\n正在停止 WebUI 服务器...")
        print("WebUI 已停止")
    except Exception as e:
        print(f"启动 WebUI 失败: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()