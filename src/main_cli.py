import argparse
import os
import subprocess
import shutil
import sys
import threading
import time
import socket
from config import ConfigManager
from stconfig import stcfg

class SillyTavernCliLauncher:
    def __init__(self):
        self.config_manager = ConfigManager()
        self.config = self.config_manager.config
        self.process = None
        self.running = False
        self.sync_server = None

        # 检查系统环境
        self.check_system_env()

        self.stCfg = stcfg()

    def check_system_env(self):
        """检查系统环境依赖"""
        print("检查系统环境依赖...")
        
        # 检查Git
        if not self.is_command_available("git"):
            print("错误: 未找到 Git，请先安装 Git")
            return False
            
        # 检查Node.js
        if not self.is_command_available("node"):
            print("错误: 未找到 Node.js，请先安装 Node.js")
            return False
            
        # 检查npm
        if not self.is_command_available("npm"):
            print("错误: 未找到 npm，请先安装 npm")
            return False
            
        print("系统环境依赖检查通过")
        return True

    def is_command_available(self, cmd):
        """检查命令是否可用"""
        return shutil.which(cmd) is not None

    def get_github_mirror(self):
        """获取GitHub镜像地址"""
        mirror = self.config_manager.get("github.mirror", "github")
        if mirror == "github":
            return "https://github.com"
        else:
            # 使用镜像站
            return f"https://{mirror}/https://github.com"

    def run_command_with_output(self, cmd, cwd=None):
        """运行命令并实时输出结果"""
        print(f"执行命令: {' '.join(cmd)}")
        if cwd:
            print(f"工作目录: {cwd}")
        
        try:
            process = subprocess.Popen(
                cmd, 
                cwd=cwd,
                stdout=subprocess.PIPE, 
                stderr=subprocess.STDOUT, 
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            
            # 实时输出命令执行结果
            while True:
                output = process.stdout.readline()
                if output == '' and process.poll() is not None:
                    break
                if output:
                    print(output.strip())
            
            # 等待进程结束并获取返回码
            rc = process.poll()
            return rc == 0
            
        except Exception as e:
            print(f"执行命令时出错: {e}")
            return False

    def install_sillytavern(self):
        """安装SillyTavern"""
        print("开始安装 SillyTavern...")
        
        # 检查系统环境
        if not self.check_system_env():
            print("环境检查失败，无法继续安装")
            return
            
        st_dir = os.path.join(os.getcwd(), "SillyTavern")
        
        # 如果目录已存在，询问是否重新安装
        if os.path.exists(st_dir):
            choice = input("SillyTavern 目录已存在，是否重新安装？(y/N): ")
            if choice.lower() != 'y':
                print("取消安装")
                return
            else:
                print("删除现有目录...")
                shutil.rmtree(st_dir)
        
        try:
            # 获取镜像配置
            mirror = self.config_manager.get("github.mirror", "github")
            
            # 根据是否使用镜像决定仓库地址
            if mirror == "github":
                # 使用GitHub官方仓库
                repo_url = "https://github.com/SillyTavern/SillyTavern.git"
                print(f"正在克隆 SillyTavern 仓库 (使用官方源)...")
            else:
                # 使用Gitee镜像仓库
                repo_url = "https://gitee.com/lingyesoul/SillyTavern.git"
                print(f"正在克隆 SillyTavern 仓库 (使用Gitee镜像)...")
            
            # 克隆SillyTavern仓库
            success = self.run_command_with_output([
                "git", "clone", repo_url, "SillyTavern"
            ])
            
            if not success:
                print("克隆失败")
                return
                
            print("克隆完成，安装 Node.js 依赖...")
            
            # 进入SillyTavern目录
            st_dir = os.path.join(os.getcwd(), "SillyTavern")
            
            # 根据是否使用镜像选择npm命令
            if self.config_manager.get("github.mirror", "github") != "github":
                # 使用国内镜像安装依赖
                print("使用国内NPM镜像源安装依赖...")
                success = self.run_command_with_output([
                    "npm", "install", "--no-audit", "--no-fund", 
                    "--registry=https://registry.npmmirror.com"
                ], cwd=st_dir)
            else:
                # 使用默认源安装依赖
                print("使用默认NPM源安装依赖...")
                success = self.run_command_with_output([
                    "npm", "install", "--no-audit", "--no-fund"
                ], cwd=st_dir)
            
            if not success:
                print("依赖安装失败")
                return
            
            print("SillyTavern 安装完成!")
            
        except Exception as e:
            print(f"安装过程中出现未知错误: {e}")
            return

    def start_sillytavern(self):
        """启动SillyTavern"""
        print("正在启动 SillyTavern...")
        try:
            # 获取SillyTavern目录
            st_dir = os.path.join(os.getcwd(), "SillyTavern")
            if not os.path.exists(st_dir):
                # SillyTavern未安装，询问用户是否安装
                choice = input("SillyTavern 未找到，是否立即安装？(Y/n): ")
                if choice.lower() != 'n':
                    self.install_sillytavern()
                    if not os.path.exists(st_dir):
                        print("安装似乎失败了，请检查错误信息")
                        return
                else:
                    print("取消启动")
                    return
            
            # 构建启动命令
            cmd = ["node", "server.js"]
            
            # 如果配置了端口
            if hasattr(self.stCfg, 'port') and self.stCfg.port:
                cmd.extend(["--port", str(self.stCfg.port)])
            
            # 如果配置了监听所有地址
            if hasattr(self.stCfg, 'listen') and self.stCfg.listen:
                cmd.append("--listen")
            
            print(f"启动命令: {' '.join(cmd)}")
            print(f"工作目录: {st_dir}")
            
            # 切换到SillyTavern目录
            os.chdir(st_dir)
            
            # 使用os.execvp替换当前进程
            print("SillyTavern 已启动")
            print("-" * 50)
            os.execvp("node", cmd)
            
        except Exception as e:
            print(f"启动 SillyTavern 时出错: {e}")


    def show_config(self):
        """显示当前配置"""
        print("当前配置:")
        for key, value in self.config.items():
            print(f"  {key}: {value}")
        
        # 显示SillyTavern配置
        print("\nSillyTavern 配置:")
        print(f"  端口: {self.stCfg.port}")
        print(f"  监听所有地址: {self.stCfg.listen}")
        
        # 显示GitHub镜像配置
        mirror = self.config_manager.get("github.mirror", "github")
        print(f"\nGitHub 镜像配置:")
        print(f"  镜像源: {mirror}")

    def setup_autostart(self):
        """设置自启动"""
        self.config_manager.set("autostart", True)
        self.config_manager.save_config()
        print("已设置为自启动")

    def disable_autostart(self):
        """禁用自启动"""
        self.config_manager.set("autostart", False)
        self.config_manager.save_config()
        print("已禁用自启动")

    def update_sillytavern(self):
        """更新SillyTavern"""
        print("正在更新 SillyTavern...")
        
        st_dir = os.path.join(os.getcwd(), "SillyTavern")
        if not os.path.exists(st_dir):
            print("错误: SillyTavern 未安装，请先运行 install 命令")
            return
        
        try:
            # 拉取最新代码
            print("正在拉取最新代码...")
            success = self.run_command_with_output(["git", "pull"], cwd=st_dir)
            if not success:
                print("更新代码失败")
                return
            
            # 更新Node.js依赖
            print("正在更新 Node.js 依赖...")
            # 根据是否使用镜像选择npm命令
            if self.config_manager.get("github.mirror", "github") != "github":
                # 使用国内镜像更新依赖
                success = self.run_command_with_output([
                    "npm", "install", "--no-audit", "--no-fund", 
                    "--registry=https://registry.npmmirror.com"
                ], cwd=st_dir)
            else:
                # 使用默认源更新依赖
                success = self.run_command_with_output([
                    "npm", "install", "--no-audit", "--no-fund"
                ], cwd=st_dir)
            
            if not success:
                print("依赖更新失败")
                return
            
            print("SillyTavern 更新完成!")
            
        except Exception as e:
            print(f"更新过程中出现未知错误: {e}")
            return

    def set_github_mirror(self, mirror):
        """设置GitHub镜像"""
        # 设置镜像配置
        self.config_manager.set("github.mirror", mirror)
        self.config_manager.save_config()
        print(f"GitHub 镜像已设置为: {mirror}")
        
        # 配置Git全局设置
        try:
            # 清除现有的GitHub镜像配置
            clear_result = subprocess.run(
                ["git", "config", "--global", "--unset-all", "url.https://github.com/.insteadof"],
                capture_output=True, text=True
            )
            
            # 如果使用镜像且不是官方源，则配置Git全局镜像
            if mirror != "github":
                # 配置GitHub镜像
                mirror_url = f"https://{mirror}/https://github.com/"
                subprocess.run(
                    ["git", "config", "--global", f"url.{mirror_url}.insteadof", "https://github.com/"],
                    check=True, capture_output=True, text=True
                )
                print(f"Git全局镜像已配置: {mirror_url} -> https://github.com/")
                
                # 如果SillyTavern已经安装，还需要切换其远程地址
                st_dir = os.path.join(os.getcwd(), "SillyTavern")
                if os.path.exists(st_dir) and os.path.exists(os.path.join(st_dir, ".git")):
                    # 切换SillyTavern仓库远程地址为Gitee镜像
                    result = subprocess.run(
                        ["git", "remote", "set-url", "origin", "https://gitee.com/lingyesoul/SillyTavern.git"],
                        cwd=st_dir,
                        capture_output=True, text=True
                    )
                    
                    if result.returncode == 0:
                        print("SillyTavern仓库远程地址已切换到Gitee镜像")
                    else:
                        print(f"切换SillyTavern仓库远程地址失败: {result.stderr}")
            else:
                # 使用官方源时，如果有SillyTavern目录，尝试切换回官方地址
                st_dir = os.path.join(os.getcwd(), "SillyTavern")
                if os.path.exists(st_dir) and os.path.exists(os.path.join(st_dir, ".git")):
                    result = subprocess.run(
                        ["git", "remote", "set-url", "origin", "https://github.com/SillyTavern/SillyTavern.git"],
                        cwd=st_dir,
                        capture_output=True, text=True
                    )
                    
                    if result.returncode == 0:
                        print("SillyTavern仓库远程地址已切换回官方地址")
                    else:
                        print(f"切换SillyTavern仓库远程地址失败: {result.stderr}")
                        
        except subprocess.CalledProcessError as e:
            print(f"配置Git全局镜像时出错: {e}")
        except Exception as e:
            print(f"配置Git全局镜像时发生未知错误: {e}")

    def start_sync_server(self, port=None, host='0.0.0.0'):
        """启动数据同步服务器"""
        try:
            # Import sync_server module
            from sync_server import SyncServer

            # Get SillyTavern data path
            data_path = os.path.join(os.getcwd(), "SillyTavern", "data", "default-user")
            if not os.path.exists(data_path):
                print(f"错误: SillyTavern 数据目录不存在: {data_path}")
                return False

            # Use provided port or get from config
            if port is None:
                port = self.config_manager.get("sync.port", 9999)

            # Initialize sync server
            self.sync_server = SyncServer(
                data_path=data_path,
                port=port,
                host=host
            )

            # Start server in background
            self.sync_server.start(block=False)

            # Get local IP address for client connections
            local_ip = self._get_local_ip()
            print(f"数据同步服务已启动!")
            print(f"服务器地址: http://{local_ip}:{port}")
            print(f"本地地址: http://localhost:{port}")
            print(f"数据路径: {data_path}")
            print("\n可用接口:")
            print("  /manifest    - 获取文件清单")
            print("  /zip         - 下载所有数据(ZIP)")
            print("  /file?path=  - 下载指定文件")
            print("  /health      - 健康检查")
            print("  /info        - 服务器信息")

            # Save sync server config
            self.config_manager.set("sync.enabled", True)
            self.config_manager.set("sync.port", port)
            self.config_manager.set("sync.host", host)
            self.config_manager.save_config()

            return True

        except Exception as e:
            print(f"启动同步服务器失败: {e}")
            return False

    def stop_sync_server(self):
        """停止数据同步服务器"""
        if self.sync_server and self.sync_server.running:
            self.sync_server.stop()
            self.sync_server = None
            self.config_manager.set("sync.enabled", False)
            self.config_manager.save_config()
            print("数据同步服务已停止")
        else:
            print("数据同步服务未运行")

    def sync_from_server(self, server_url, method='auto', backup=True):
        """从远程服务器同步数据"""
        try:
            # Import sync_client module
            from sync_client import SyncClient

            # Get local data path
            data_path = os.path.join(os.getcwd(), "SillyTavern", "data", "default-user")
            os.makedirs(os.path.dirname(data_path), exist_ok=True)

            # Initialize sync client
            client = SyncClient(server_url, data_path)

            # Check server health first
            if not client.check_server_health():
                print("无法连接到服务器或服务器不健康")
                return False

            # Get server info
            server_info = client.get_server_info()
            if server_info:
                info = server_info.get('server_info', {})
                print(f"服务器信息:")
                print(f"  文件数量: {info.get('file_count', 0)}")
                print(f"  总大小: {client._format_size(info.get('total_size', 0))}")

            # Perform sync
            print(f"开始从服务器同步: {server_url}")
            success = client.sync(prefer_zip=(method == 'auto' or method == 'zip'), backup=backup)

            if success:
                print("数据同步完成!")
                return True
            else:
                print("数据同步失败!")
                return False

        except Exception as e:
            print(f"数据同步过程中发生错误: {e}")
            return False

    def _get_local_ip(self):
        """获取本地IP地址"""
        try:
            # Connect to a public server to get local IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            # Fallback to common local IPs
            return "127.0.0.1"

    def _scan_sync_servers(self, ports=None):
        """扫描本地网络中的同步服务器"""
        if ports is None:
            ports = [9999, 5000, 8080, 8081, 8082, 9000]

        try:
            from sync_client import SyncClient
        except ImportError:
            print("错误: 无法导入同步客户端模块")
            return

        local_ip = self._get_local_ip()
        if not local_ip or local_ip == "127.0.0.1":
            print("无法获取本地IP地址，请手动输入服务器地址")
            return

        # 获取网络前缀
        ip_parts = local_ip.split('.')
        network_prefix = '.'.join(ip_parts[:3]) + '.'

        print(f"扫描网络范围: {network_prefix}1-254")
        print("扫描端口:", ', '.join(map(str, ports)))
        print("-" * 50)

        found_servers = []

        # 扫描常用IP段和端口
        for port in ports:
            # 首先检查本地
            if self._check_sync_server(f"http://127.0.0.1:{port}"):
                found_servers.append(f"127.0.0.1:{port}")

            # 检查当前IP
            if self._check_sync_server(f"http://{local_ip}:{port}"):
                found_servers.append(f"{local_ip}:{port}")

            # 扫描同网络段的部分IP（限制扫描范围以提高速度）
            for i in [1, 2, 100, 101, 254]:  # 常用的网关地址
                if i != int(ip_parts[3]):  # 跳过自己的IP
                    test_ip = network_prefix + str(i)
                    if self._check_sync_server(f"http://{test_ip}:{port}"):
                        found_servers.append(f"{test_ip}:{port}")

        print("\n扫描完成!")
        if found_servers:
            print(f"发现 {len(found_servers)} 个可用的同步服务器:")
            print("-" * 40)
            for i, server in enumerate(found_servers, 1):
                print(f"{i}. http://{server}")
            print("-" * 40)

            try:
                choice = input("请选择服务器编号或按Enter继续: ").strip()
                if choice and choice.isdigit() and 1 <= int(choice) <= len(found_servers):
                    selected_server = found_servers[int(choice) - 1]
                    self._connect_and_sync(f"http://{selected_server}")

                    # 询问是否将此服务器保存为快捷连接
                    save_choice = input("是否保存此服务器地址为快捷连接？(y/N): ").strip()
                    if save_choice.lower() == 'y':
                        saved_servers = self.config_manager.get("sync.saved_servers", [])
                        server_url = f"http://{selected_server}"
                        if server_url not in saved_servers:
                            saved_servers.append(server_url)
                            self.config_manager.set("sync.saved_servers", saved_servers)
                            self.config_manager.save_config()
                            print(f"服务器已保存: {server_url}")
                        else:
                            print("此服务器已在保存列表中")
            except (ValueError, KeyboardInterrupt):
                print("\n取消操作")
        else:
            print("未发现可用的同步服务器")
            print("请确保:")
            print("1. 其他设备上的同步服务器已启动")
            print("2. 防火墙允许端口访问")
            print("3. 设备在同一网络中")

    def _check_sync_server(self, server_url, timeout=3):
        """检查同步服务器是否可用"""
        try:
            from sync_client import SyncClient
            client = SyncClient(server_url, timeout=timeout)
            if client.check_server_health():
                print(f"✓ 发现服务器: {server_url}")
                return True
            return False
        except Exception:
            return False

    def _connect_and_sync(self, server_url):
        """连接到服务器并执行同步"""
        try:
            from sync_client import SyncClient
            client = SyncClient(server_url)

            print(f"\n连接到服务器: {server_url}")

            # 获取服务器信息
            server_info = client.get_server_info()
            if server_info:
                info = server_info.get('server_info', {})
                print(f"服务器信息:")
                print(f"  文件数量: {info.get('file_count', 0)}")
                print(f"  总大小: {client._format_size(info.get('total_size', 0))}")

            # 询问是否同步
            sync_choice = input("是否从此服务器同步数据？(Y/n): ").strip()
            if sync_choice.lower() != 'n':
                print("请选择同步方法:")
                print("1. 自动 (优先ZIP，失败后增量)")
                print("2. ZIP全量同步")
                print("3. 增量同步")
                method_choice = input("请选择 [1-3]: ").strip()

                method_map = {
                    "1": "auto",
                    "2": "zip",
                    "3": "incremental"
                }
                method = method_map.get(method_choice, "auto")

                backup_choice = input("是否备份现有数据？(Y/n): ").strip()
                backup = backup_choice.lower() != 'n'

                success = client.sync(prefer_zip=(method == 'auto' or method == 'zip'), backup=backup)
                if success:
                    print("同步完成!")
                else:
                    print("同步失败!")

        except Exception as e:
            print(f"连接或同步失败: {e}")

    def _manage_saved_servers(self):
        """管理已保存的服务器列表"""
        saved_servers = self.config_manager.get("sync.saved_servers", [])

        while True:
            print("\n" + "="*40)
            print("已保存的同步服务器")
            print("="*40)

            if not saved_servers:
                print("暂无已保存的服务器")
                print("可以通过扫描服务器并选择保存来添加")
                input("按Enter返回...")
                return

            for i, server_url in enumerate(saved_servers, 1):
                print(f"{i}. {server_url}")

            print("\n选项:")
            print("1. 连接并同步")
            print("2. 测试连接")
            print("3. 删除服务器")
            print("4. 清空列表")
            print("0. 返回")
            print("="*40)

            try:
                choice = input("请选择操作 [0-4]: ").strip()

                if choice == "0":
                    break
                elif not saved_servers:
                    print("没有可操作的服务器")
                    continue

                if choice == "1":
                    # 连接并同步
                    try:
                        server_choice = input(f"请选择服务器编号 [1-{len(saved_servers)}]: ").strip()
                        if server_choice.isdigit() and 1 <= int(server_choice) <= len(saved_servers):
                            selected_server = saved_servers[int(server_choice) - 1]
                            self._connect_and_sync(selected_server)
                        else:
                            print("无效的服务器编号")
                    except ValueError:
                        print("请输入有效的编号")

                elif choice == "2":
                    # 测试连接
                    try:
                        server_choice = input(f"请选择服务器编号 [1-{len(saved_servers)}]: ").strip()
                        if server_choice.isdigit() and 1 <= int(server_choice) <= len(saved_servers):
                            selected_server = saved_servers[int(server_choice) - 1]
                            print(f"正在测试连接: {selected_server}")
                            if self._check_sync_server(selected_server):
                                print("✓ 连接成功!")
                            else:
                                print("✗ 连接失败!")
                        else:
                            print("无效的服务器编号")
                    except ValueError:
                        print("请输入有效的编号")

                elif choice == "3":
                    # 删除服务器
                    try:
                        server_choice = input(f"请选择要删除的服务器编号 [1-{len(saved_servers)}]: ").strip()
                        if server_choice.isdigit() and 1 <= int(server_choice) <= len(saved_servers):
                            selected_server = saved_servers[int(server_choice) - 1]
                            confirm = input(f"确认删除 '{selected_server}'? (y/N): ").strip()
                            if confirm.lower() == 'y':
                                saved_servers.remove(selected_server)
                                self.config_manager.set("sync.saved_servers", saved_servers)
                                self.config_manager.save_config()
                                print(f"已删除: {selected_server}")
                            else:
                                print("取消删除")
                        else:
                            print("无效的服务器编号")
                    except ValueError:
                        print("请输入有效的编号")

                elif choice == "4":
                    # 清空列表
                    confirm = input("确认清空所有已保存的服务器? (y/N): ").strip()
                    if confirm.lower() == 'y':
                        saved_servers.clear()
                        self.config_manager.set("sync.saved_servers", saved_servers)
                        self.config_manager.save_config()
                        print("已清空所有已保存的服务器")
                    else:
                        print("取消清空")

                else:
                    print("无效选择，请输入 0-4 之间的数字")

            except (ValueError, KeyboardInterrupt):
                print("\n操作取消")
                break

    def show_sync_menu(self):
        """显示同步菜单"""
        while True:
            print("\n" + "="*50)
            print("数据同步菜单")
            print("="*50)

            sync_enabled = self.config_manager.get("sync.enabled", False)
            sync_port = self.config_manager.get("sync.port", 9999)
            sync_host = self.config_manager.get("sync.host", "0.0.0.0")

            print(f"当前同步状态: {'启用' if sync_enabled else '禁用'}")
            if sync_enabled:
                local_ip = self._get_local_ip()
                print(f"服务器地址: http://{local_ip}:{sync_port}")

            print("\n选项:")
            print("1. 启动同步服务器")
            print("2. 停止同步服务器")
            print("3. 从服务器同步数据")
            print("4. 显示同步配置")
            print("5. 测试服务器连接")
            print("6. 设置同步服务器端口")
            print("7. 扫描本地同步服务器")
            saved_servers = self.config_manager.get("sync.saved_servers", [])
            if saved_servers:
                print("8. 已保存的服务器列表")
            print("0. 返回主菜单")
            print("="*50)

            try:
                choice = input("请选择操作 [0-8]: ").strip()

                if choice == "1":
                    if not sync_enabled:
                        print("正在启动同步服务器...")
                        self.start_sync_server()
                    else:
                        print("同步服务器已在运行")
                elif choice == "2":
                    if sync_enabled:
                        print("正在停止同步服务器...")
                        self.stop_sync_server()
                    else:
                        print("同步服务器未运行")
                elif choice == "3":
                    server_url = input("请输入服务器地址 (例如: http://192.168.1.100:5000): ").strip()
                    if server_url:
                        print("请选择同步方法:")
                        print("1. 自动 (优先ZIP，失败后增量)")
                        print("2. ZIP全量同步")
                        print("3. 增量同步")
                        method_choice = input("请选择 [1-3]: ").strip()

                        method_map = {
                            "1": "auto",
                            "2": "zip",
                            "3": "incremental"
                        }
                        method = method_map.get(method_choice, "auto")

                        backup_choice = input("是否备份现有数据？(Y/n): ").strip()
                        backup = backup_choice.lower() != 'n'

                        self.sync_from_server(server_url, method, backup)
                elif choice == "4":
                    print("当前同步配置:")
                    print(f"  启用状态: {sync_enabled}")
                    print(f"  监听主机: {sync_host}")
                    print(f"  监听端口: {sync_port}")
                    if sync_enabled:
                        data_path = os.path.join(os.getcwd(), "SillyTavern", "data", "default-user")
                        print(f"  数据路径: {data_path}")
                        local_ip = self._get_local_ip()
                        print(f"  客户端地址: http://{local_ip}:{sync_port}")
                elif choice == "5":
                    server_url = input("请输入服务器地址进行测试: ").strip()
                    if server_url:
                        try:
                            from sync_client import SyncClient
                            client = SyncClient(server_url)
                            if client.check_server_health():
                                server_info = client.get_server_info()
                                if server_info:
                                    info = server_info.get('server_info', {})
                                    print("服务器连接正常!")
                                    print(f"  文件数量: {info.get('file_count', 0)}")
                                    print(f"  总大小: {client._format_size(info.get('total_size', 0))}")
                            else:
                                print("服务器连接失败")
                        except Exception as e:
                            print(f"测试连接失败: {e}")
                elif choice == "6":
                    # 设置同步服务器端口
                    try:
                        new_port = input(f"请输入新的端口号 (当前: {sync_port}): ").strip()
                        if new_port:
                            port_num = int(new_port)
                            if 1 <= port_num <= 65535:
                                self.config_manager.set("sync.port", port_num)
                                self.config_manager.save_config()
                                sync_port = port_num
                                print(f"同步服务器端口已设置为: {port_num}")

                                # 如果服务器正在运行，询问是否重启
                                if sync_enabled and self.sync_server:
                                    restart = input("同步服务器正在运行，是否重启以应用新端口？(Y/n): ").strip()
                                    if restart.lower() != 'n':
                                        print("正在重启同步服务器...")
                                        self.stop_sync_server()
                                        self.start_sync_server(sync_port, sync_host)
                            else:
                                print("错误: 端口号必须在 1-65535 范围内")
                        else:
                            print("端口未修改")
                    except ValueError:
                        print("错误: 请输入有效的端口号")
                elif choice == "7":
                    # 扫描本地同步服务器
                    print("正在扫描本地同步服务器...")
                    self._scan_sync_servers()
                elif choice == "8":
                    # 处理已保存的服务器列表
                    self._manage_saved_servers()
                elif choice == "0":
                    break
                else:
                    print("无效选择，请输入 0-8 之间的数字")

            except KeyboardInterrupt:
                print("\n收到退出信号，返回主菜单...")
                break
            except Exception as e:
                print(f"发生错误: {e}")

    def update_component(self, component):
        """更新指定组件"""
        if component == "st":
            self.update_sillytavern()
        elif component == "stl":
            self.update_launcher(True)  # 更新启动器后需要重启
        else:
            print(f"未知组件: {component}，支持的组件: st, stl")

    def update_interactive(self):
        """交互式更新选择"""
        print("\n请选择要更新的内容:")
        print("1. 更新 SillyTavern")
        print("2. 更新 SillyTavernLauncher")
        print("3. 更新所有内容")
        print("4. 重启启动器")
        print("0. 取消")
        
        choice = input("请输入选项 [0-4]: ").strip()
        
        if choice == "1":
            self.update_sillytavern()
        elif choice == "2":
            self.update_launcher(True)  # 更新启动器后需要重启
        elif choice == "3":
            self.update_sillytavern()
            self.update_launcher(True)  # 更新启动器后需要重启
        elif choice == "4":
            print("正在重新启动启动器...")
            # 获取当前的参数
            args = sys.argv[1:]  # 获取除脚本名外的所有参数
            # 重新执行脚本
            os.execv(sys.executable, [sys.executable] + [sys.argv[0]] + ["menu"])
        elif choice == "0":
            print("取消更新")
        else:
            print("无效选择")

    def update_launcher(self, restart_after=False):
        """更新SillyTavernLauncher本身"""
        print("正在更新 SillyTavernLauncher...")
        
        try:
            # 获取当前目录（应该在SillyTavernLauncher目录中）
            launcher_dir = os.getcwd()
            print(f"工作目录: {launcher_dir}")
            
            # 拉取最新代码
            print("正在拉取最新代码...")
            success = self.run_command_with_output(["git", "pull"], cwd=launcher_dir)
            if not success:
                print("更新代码失败")
                return
            
            # 更新Python依赖
            print("正在更新Python依赖...")
            # 激活虚拟环境并更新依赖
            venv_python = os.path.join(launcher_dir, "venv", "bin", "python")
            if not os.path.exists(venv_python):
                venv_python = "python"  # 回退到系统python
                
            success = self.run_command_with_output([
                venv_python, "-m", "pip", "install", "--upgrade", 
                "aiohttp==3.12.4", "ruamel.yaml", "packaging"
            ], cwd=launcher_dir)
            
            if not success:
                print("依赖更新失败")
                return
            
            # 重载配置
            self.config_manager.reload()
            self.config = self.config_manager.config
            
            print("SillyTavernLauncher 更新完成!")
            
            # 如果需要重启
            if restart_after:
                print("正在重新启动启动器...")
                # 获取当前的参数
                args = sys.argv[1:]  # 获取除脚本名外的所有参数
                # 重新执行脚本，强制进入菜单模式
                os.execv(sys.executable, [sys.executable] + [sys.argv[0]] + ["menu"])
            
        except Exception as e:
            print(f"更新过程中出现未知错误: {e}")
            return

    def show_menu(self):
        """显示菜单UI"""
        while True:
            print("\n" + "="*50)
            print("SillyTavernLauncher 菜单")
            print("="*50)
            print("1. 安装 SillyTavern")
            print("2. 启动 SillyTavern")
            print("3. 显示配置")
            print("4. 启用一键启动")
            print("5. 禁用一键启动")
            print("6. 更新 SillyTavern")
            print("7. 更新 SillyTavernLauncher")
            print("8. 设置 GitHub 镜像")
            print("9. 数据同步(测试中)")
            print("0. 退出")
            print("="*50)
            
            try:
                choice = input("请选择操作 [0-9]: ").strip()
                
                if choice == "1":
                    self.install_sillytavern()
                elif choice == "2":
                    try:
                        self.start_sillytavern()
                    except KeyboardInterrupt:
                        print("\n收到中断信号，正在退出...")
                        # 当使用execvp时，控制权已转移，这里不会捕获到子进程的中断
                        pass
                elif choice == "3":
                    self.show_config()
                elif choice == "4":
                    self.config_manager.set("autostart", True)
                    self.config_manager.save_config()
                    print("已启用一键启动功能，输入st将直接启动SillyTavern")
                elif choice == "5":
                    self.config_manager.set("autostart", False)
                    self.config_manager.save_config()
                    print("已禁用一键启动功能，输入st将显示菜单")
                elif choice == "6":
                    self.update_sillytavern()
                elif choice == "7":
                    self.update_launcher(True)  # 更新启动器后需要重启
                elif choice == "8":
                    self.show_mirror_menu()
                elif choice == "9":
                    self.show_sync_menu()
                elif choice == "0":
                    print("感谢使用 SillyTavernLauncher!")
                    break
                else:
                    print("无效选择，请输入 0-9 之间的数字")
                    
            except KeyboardInterrupt:
                print("\n\n收到退出信号，正在退出...")
                break
            except Exception as e:
                print(f"发生错误: {e}")

    def show_mirror_menu(self):
        """显示镜像设置菜单"""
        print("\nGitHub 镜像设置:")
        print("1. github.com (官方源)")
        print("2. gh-proxy.org")
        print("3. ghfile.geekertao.top")
        print("4. gh.dpik.top")
        print("5. github.dpik.top")
        print("6. github.acmsz.top")
        print("7. git.yylx.win")
        print("0. 返回上级菜单")
        
        choice = input("请选择镜像源 [0-7]: ").strip()
        
        mirror_map = {
            "1": "github",
            "2": "gh-proxy.org",
            "3": "ghfile.geekertao.top",
            "4": "gh.dpik.top",
            "5": "github.dpik.top",
            "6": "github.acmsz.top",
            "7": "git.yylx.win"
        }
        
        if choice in mirror_map:
            self.set_github_mirror(mirror_map[choice])
        elif choice == "0":
            return
        else:
            print("无效选择")

def main():
    parser = argparse.ArgumentParser(description="SillyTavernLauncher for Termux")
    parser.add_argument("command", nargs='?', choices=[
        "install", "start", "launch", "config",
        "autostart", "update", "menu", "set-mirror", "sync"
    ], help="要执行的命令")
    parser.add_argument("subcommand", nargs='?', help="子命令")
    parser.add_argument("--mirror", help="设置GitHub镜像源")
    parser.add_argument("--port", type=int, default=9999, help="同步服务器端口")
    parser.add_argument("--host", default='0.0.0.0', help="同步服务器主机地址")
    parser.add_argument("--server-url", help="同步源服务器地址")
    parser.add_argument("--method", choices=['auto', 'zip', 'incremental'],
                       default='auto', help="同步方法")
    parser.add_argument("--no-backup", action='store_true', help="同步时不备份现有数据")
    
    args = parser.parse_args()
    
    launcher = SillyTavernCliLauncher()
    
    # 检查是否启用了"一键启动"功能
    autostart_enabled = launcher.config_manager.get("autostart", False)
    
    # 如果没有提供命令参数
    if not args.command:
        # 如果启用了"一键启动"功能，则直接启动SillyTavern
        if autostart_enabled:
            launcher.start_sillytavern()
        else:
            # 否则显示菜单
            launcher.show_menu()
        return
    
    if args.command == "install":
        launcher.install_sillytavern()
    elif args.command == "start":
        try:
            launcher.start_sillytavern()
        except KeyboardInterrupt:
            print("\n收到中断信号，正在停止...")
            # 需要保留停止功能以处理Ctrl+C
            if launcher.running and launcher.process:
                launcher.process.terminate()
                try:
                    launcher.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    launcher.process.kill()
                launcher.running = False
    elif args.command == "launch":
            launcher.start_sillytavern()
    elif args.command == "config":
        launcher.show_config()
    elif args.command == "autostart":
        if args.subcommand:
            if args.subcommand == "enable":
                launcher.config_manager.set("autostart", True)
                launcher.config_manager.save_config()
                print("已启用一键启动功能")
            elif args.subcommand == "disable":
                launcher.config_manager.set("autostart", False)
                launcher.config_manager.save_config()
                print("已禁用一键启动功能")
            else:
                print("无效的操作，请使用 enable 或 disable")
        else:
            print("请指定autostart操作: enable 或 disable")
    elif args.command == "update":
        if args.subcommand:
            launcher.update_component(args.subcommand)
        else:
            # 交互式更新选择
            launcher.update_interactive()
    elif args.command == "menu":
        launcher.show_menu()
    elif args.command == "set-mirror":
        if args.mirror:
            launcher.set_github_mirror(args.mirror)
        else:
            print("请提供镜像源参数，例如: st set-mirror --mirror gh-proxy.org")
    elif args.command == "sync":
        if args.subcommand == "start":
            launcher.start_sync_server(args.port, args.host)
        elif args.subcommand == "stop":
            launcher.stop_sync_server()
        elif args.subcommand == "from":
            if not args.server_url:
                print("请提供服务器地址，例如: st sync from --server-url http://192.168.1.100:5000")
            else:
                launcher.sync_from_server(
                    args.server_url,
                    args.method,
                    not args.no_backup
                )
        elif args.subcommand == "menu":
            launcher.show_sync_menu()
        else:
            print("可用的同步子命令:")
            print("  st sync start           - 启动同步服务器")
            print("  st sync stop            - 停止同步服务器")
            print("  st sync from --server-url <URL>  - 从服务器同步数据")
            print("  st sync menu            - 进入同步菜单")
            print("")
            print("可选参数:")
            print("  --port <port>           - 服务器端口 (默认: 5000)")
            print("  --host <host>           - 服务器主机地址 (默认: 0.0.0.0)")
            print("  --method <method>       - 同步方法: auto, zip, incremental (默认: auto)")
            print("  --no-backup             - 同步时不备份现有数据")
            print("")
            print("示例:")
            print("  st sync start --port 8080")
            print("  st sync from --server-url http://192.168.1.100:5000")
            print("  st sync from --server-url http://192.168.1.100:5000 --method zip")

if __name__ == "__main__":
    main()