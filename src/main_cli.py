import argparse
import os
import subprocess
import shutil
import sys
from config import ConfigManager
from stconfig import stcfg

class SillyTavernCliLauncher:
    def __init__(self):
        self.config_manager = ConfigManager()
        self.config = self.config_manager.config
        self.process = None
        self.running = False
        
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
            # 获取镜像地址
            mirror_url = self.get_github_mirror()
            repo_url = f"{mirror_url}/SillyTavern/SillyTavern.git"
            
            # 克隆SillyTavern仓库
            print(f"正在克隆 SillyTavern 仓库 (使用镜像: {mirror_url})...")
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
                print("错误: SillyTavern 未安装，请先运行 install 命令")
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
            
            # 启动进程
            self.process = subprocess.Popen(
                cmd,
                cwd=st_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            
            self.running = True
            print("SillyTavern 已启动，PID:", self.process.pid)
            print("按 Ctrl+C 停止服务")
            print("-" * 50)
            
            # 实时输出日志
            try:
                while True:
                    output = self.process.stdout.readline()
                    if output == '' and self.process.poll() is not None:
                        break
                    if output:
                        print(output.strip())
            except KeyboardInterrupt:
                print("\n收到中断信号，正在停止...")
                self.stop_sillytavern()
            
            # 等待进程结束
            self.process.wait()
            self.running = False
            print("SillyTavern 已停止")
            
        except Exception as e:
            print(f"启动 SillyTavern 时出错: {e}")
            self.running = False

    def stop_sillytavern(self):
        """停止SillyTavern"""
        if self.running and self.process:
            print("正在停止 SillyTavern...")
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.running = False
            print("SillyTavern 已停止")
        else:
            print("SillyTavern 未在运行")

    def check_status(self):
        """检查运行状态"""
        # 检查SillyTavern是否已安装
        st_dir = os.path.join(os.getcwd(), "SillyTavern")
        if os.path.exists(st_dir):
            print("SillyTavern: 已安装")
        else:
            print("SillyTavern: 未安装")
        
        # 检查运行状态
        if self.running:
            print("运行状态: 正在运行")
        else:
            print("运行状态: 未运行")

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

    def show_menu(self):
        """显示菜单UI"""
        while True:
            print("\n" + "="*50)
            print("SillyTavernLauncher 菜单")
            print("="*50)
            print("1. 安装 SillyTavern")
            print("2. 启动 SillyTavern")
            print("3. 停止 SillyTavern")
            print("4. 查看运行状态")
            print("5. 显示配置")
            print("6. 启用自启动")
            print("7. 禁用自启动")
            print("8. 更新 SillyTavern")
            print("9. 设置 GitHub 镜像")
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
                        print("\n收到中断信号，正在停止...")
                        self.stop_sillytavern()
                elif choice == "3":
                    self.stop_sillytavern()
                elif choice == "4":
                    self.check_status()
                elif choice == "5":
                    self.show_config()
                elif choice == "6":
                    self.setup_autostart()
                elif choice == "7":
                    self.disable_autostart()
                elif choice == "8":
                    self.update_sillytavern()
                elif choice == "9":
                    self.show_mirror_menu()
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
        print("2. gh-proxy.com")
        print("3. ghfile.geekertao.top")
        print("4. gh.dpik.top")
        print("5. github.dpik.top")
        print("6. github.acmsz.top")
        print("7. git.yylx.win")
        print("0. 返回上级菜单")
        
        choice = input("请选择镜像源 [0-7]: ").strip()
        
        mirror_map = {
            "1": "github",
            "2": "gh-proxy.com",
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
        "install", "start", "stop", "status", "config", 
        "autostart-enable", "autostart-disable", "update", "menu", "set-mirror"
    ], help="要执行的命令")
    parser.add_argument("--mirror", help="设置GitHub镜像源")
    
    args = parser.parse_args()
    
    launcher = SillyTavernCliLauncher()
    
    # 如果没有提供命令参数，则显示菜单
    if not args.command:
        launcher.show_menu()
        return
    
    if args.command == "install":
        launcher.install_sillytavern()
    elif args.command == "start":
        try:
            launcher.start_sillytavern()
        except KeyboardInterrupt:
            print("\n收到中断信号，正在停止...")
            launcher.stop_sillytavern()
    elif args.command == "stop":
        launcher.stop_sillytavern()
    elif args.command == "status":
        launcher.check_status()
    elif args.command == "config":
        launcher.show_config()
    elif args.command == "autostart-enable":
        launcher.setup_autostart()
    elif args.command == "autostart-disable":
        launcher.disable_autostart()
    elif args.command == "update":
        launcher.update_sillytavern()
    elif args.command == "menu":
        launcher.show_menu()
    elif args.command == "set-mirror":
        if args.mirror:
            launcher.set_github_mirror(args.mirror)
        else:
            print("请提供镜像源参数，例如: st set-mirror --mirror gh-proxy.com")

if __name__ == "__main__":
    main()