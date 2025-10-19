import argparse
import sys
import os
import subprocess
import threading
import time
import json
import shutil
from config import ConfigManager
from version import VersionChecker
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
            # 克隆SillyTavern仓库
            print("正在克隆 SillyTavern 仓库...")
            result = subprocess.run([
                "git", "clone", 
                "https://github.com/SillyTavern/SillyTavern.git", 
                "SillyTavern"
            ], check=True, capture_output=True, text=True)
            
            print("克隆完成，安装 Node.js 依赖...")
            
            # 进入SillyTavern目录并安装依赖
            original_dir = os.getcwd()
            os.chdir(st_dir)
            
            result = subprocess.run([
                "npm", "install", "--no-audit", "--no-fund"
            ], check=True, capture_output=True, text=True)
            
            # 返回原目录
            os.chdir(original_dir)
            
            print("SillyTavern 安装完成!")
            
        except subprocess.CalledProcessError as e:
            print(f"安装过程中出现错误: {e}")
            print(f"错误详情: {e.stderr}")
            return
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
            
            # 切换到SillyTavern目录并启动
            original_dir = os.getcwd()
            os.chdir(st_dir)
            
            # 启动命令
            cmd = ["node", "server.js"]
            
            # 如果配置了端口
            if hasattr(self.stCfg, 'port') and self.stCfg.port:
                cmd.extend(["--port", str(self.stCfg.port)])
            
            # 如果配置了监听所有地址
            if hasattr(self.stCfg, 'listen') and self.stCfg.listen:
                cmd.append("--listen")
            
            print(f"启动命令: {' '.join(cmd)}")
            self.process = subprocess.Popen(cmd)
            
            # 返回原目录
            os.chdir(original_dir)
            
            self.running = True
            print("SillyTavern 已启动，PID:", self.process.pid)
            print("按 Ctrl+C 停止服务")
            
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
            # 进入SillyTavern目录
            original_dir = os.getcwd()
            os.chdir(st_dir)
            
            # 拉取最新代码
            print("正在拉取最新代码...")
            subprocess.run(["git", "pull"], check=True)
            
            # 更新Node.js依赖
            print("正在更新 Node.js 依赖...")
            subprocess.run(["npm", "install", "--no-audit", "--no-fund"], check=True)
            
            # 返回原目录
            os.chdir(original_dir)
            
            print("SillyTavern 更新完成!")
            
        except subprocess.CalledProcessError as e:
            print(f"更新过程中出现错误: {e}")
            return
        except Exception as e:
            print(f"更新过程中出现未知错误: {e}")
            return

def main():
    parser = argparse.ArgumentParser(description="SillyTavern Launcher for Termux")
    parser.add_argument("command", choices=[
        "install", "start", "stop", "status", "config", 
        "autostart-enable", "autostart-disable", "update"
    ], help="要执行的命令")
    parser.add_argument("--version", action="version", version="SillyTavern Launcher CLI v1.2.7")
    
    args = parser.parse_args()
    
    launcher = SillyTavernCliLauncher()
    
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

if __name__ == "__main__":
    main()