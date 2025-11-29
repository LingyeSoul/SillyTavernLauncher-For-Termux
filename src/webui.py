#!/usr/bin/env python3
"""
REMI-based WebUI for SillyTavernLauncher
提供Web界面来管理SillyTavern
"""

import os
import sys
import threading
import time
import socket
import subprocess
from datetime import datetime

# 添加当前目录到Python路径以导入本地模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    import remi.gui as gui
    from remi import start, App
except ImportError:
    print("错误: 未找到 remi 库")
    print("请运行: pip install remi")
    sys.exit(1)

from config import ConfigManager
from main_cli import SillyTavernCliLauncher
from stconfig import stcfg


class SillyTavernWebUI(App):
    def __init__(self, *args):
        super().__init__(*args)
        self.launcher = None
        self.sync_server = None
        self.current_tab = 'main'  # 当前显示的选项卡

    def main(self):
        # 初始化启动器
        self.launcher = SillyTavernCliLauncher()

        # 创建主容器
        main_container = gui.VBox(width='100%', height='100%', style={'margin': '10px'})

        # 标题
        title = gui.Label('SillyTavern WebUI 控制面板', style={'font-size': '24px', 'font-weight': 'bold', 'text-align': 'center', 'margin-bottom': '20px'})

        # 创建选项卡按钮容器
        tab_buttons = gui.HBox(width='100%', height='50px', style={'margin-bottom': '10px'})

        btn_main = gui.Button('主控制', width='120px', height='40px')
        btn_main.onclick.do(lambda widget: self.switch_tab('main'))

        btn_config = gui.Button('配置管理', width='120px', height='40px')
        btn_config.onclick.do(lambda widget: self.switch_tab('config'))

        btn_sync = gui.Button('数据同步', width='120px', height='40px')
        btn_sync.onclick.do(lambda widget: self.switch_tab('sync'))

        btn_status = gui.Button('系统状态', width='120px', height='40px')
        btn_status.onclick.do(lambda widget: self.switch_tab('status'))

        tab_buttons.append(btn_main)
        tab_buttons.append(gui.Label('', width='10px'))
        tab_buttons.append(btn_config)
        tab_buttons.append(gui.Label('', width='10px'))
        tab_buttons.append(btn_sync)
        tab_buttons.append(gui.Label('', width='10px'))
        tab_buttons.append(btn_status)

        # 内容容器
        self.content_container = gui.VBox(width='100%', height='80%', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '10px'})

        # 创建各个功能选项卡内容
        self.main_tab = self.create_main_tab()
        self.config_tab = self.create_config_tab()
        self.sync_tab = self.create_sync_tab()
        self.status_tab = self.create_status_tab()

        # 默认显示主控制选项卡
        self.content_container.append(self.main_tab)

        # 底部状态栏
        status_bar = self.create_status_bar()

        # 组装界面
        main_container.append(title)
        main_container.append(tab_buttons)
        main_container.append(self.content_container)
        main_container.append(status_bar)

        # 设置定时更新状态
        self.update_status_timer = gui.Timer(2.0, self.update_status)

        return main_container

    def switch_tab(self, tab_name):
        """切换选项卡"""
        # 清空当前内容
        self.content_container.clear()

        # 根据选择的选项卡显示相应内容
        if tab_name == 'main':
            self.content_container.append(self.main_tab)
        elif tab_name == 'config':
            self.content_container.append(self.config_tab)
        elif tab_name == 'sync':
            self.content_container.append(self.sync_tab)
        elif tab_name == 'status':
            self.content_container.append(self.status_tab)
            self.update_status()  # 更新状态选项卡

        self.current_tab = tab_name

    def create_main_tab(self):
        """创建主控制选项卡"""
        container = gui.VBox(width='100%', height='100%', style={'padding': '10px'})

        # SillyTavern 控制区域
        st_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px', 'margin-bottom': '20px'})
        st_title = gui.Label('SillyTavern 控制', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        # 安装按钮
        btn_install = gui.Button('安装 SillyTavern', width='200px', height='40px')
        btn_install.onclick.do(self.install_sillytavern)

        # 启动按钮
        btn_start = gui.Button('启动 SillyTavern', width='200px', height='40px', style={'background-color': '#4CAF50', 'color': 'white'})
        btn_start.onclick.do(self.start_sillytavern)

        # 更新按钮
        btn_update_st = gui.Button('更新 SillyTavern', width='200px', height='40px')
        btn_update_st.onclick.do(self.update_sillytavern)

        # 一键启动设置
        autostart_container = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        self.autostart_checkbox = gui.CheckBox(label='启用一键启动模式')
        self.autostart_checkbox.set_value(self.launcher.config_manager.get("autostart", False))
        self.autostart_checkbox.onchange.do(self.toggle_autostart)

        st_controls = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        st_controls.append(btn_install)
        st_controls.append(gui.Label('', width='10px'))
        st_controls.append(btn_start)
        st_controls.append(gui.Label('', width='10px'))
        st_controls.append(btn_update_st)

        st_container.append(st_title)
        st_container.append(st_controls)
        st_container.append(autostart_container)
        st_container.append(self.autostart_checkbox)

        # 启动器控制区域
        launcher_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px', 'margin-bottom': '20px'})
        launcher_title = gui.Label('启动器控制', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        btn_update_launcher = gui.Button('更新启动器', width='200px', height='40px')
        btn_update_launcher.onclick.do(self.update_launcher)

        btn_restart_launcher = gui.Button('重启启动器', width='200px', height='40px', style={'background-color': '#ff9800', 'color': 'white'})
        btn_restart_launcher.onclick.do(self.restart_launcher)

        launcher_controls = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        launcher_controls.append(btn_update_launcher)
        launcher_controls.append(gui.Label('', width='10px'))
        launcher_controls.append(btn_restart_launcher)

        launcher_container.append(launcher_title)
        launcher_container.append(launcher_controls)

        # 输出日志区域
        log_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px'})
        log_title = gui.Label('操作日志', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        self.log_textarea = gui.TextInput(width='100%', height='200px', multiline=True, readonly=True)
        self.log_textarea.set_value("WebUI 已就绪\n")

        btn_clear_log = gui.Button('清空日志', width='120px', height='30px')
        btn_clear_log.onclick.do(self.clear_log)

        log_controls = gui.HBox(width='100%', height='auto')
        log_controls.append(btn_clear_log)

        log_container.append(log_title)
        log_container.append(self.log_textarea)
        log_container.append(log_controls)

        # 组装主控制选项卡
        container.append(st_container)
        container.append(launcher_container)
        container.append(log_container)

        return container

    def create_config_tab(self):
        """创建配置管理选项卡"""
        container = gui.VBox(width='100%', height='100%', style={'padding': '10px'})

        # GitHub 镜像配置
        mirror_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px', 'margin-bottom': '20px'})
        mirror_title = gui.Label('GitHub 镜像配置', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        self.mirror_input = gui.TextInput(width='300px')
        self.mirror_input.set_value(self.launcher.config_manager.get("github.mirror", "github"))

        # 创建镜像选择按钮组
        mirror_buttons = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})

        # 添加常用镜像按钮
        btn_github = gui.Button('官方', width='80px', height='30px')
        btn_github.onclick.do(lambda widget: self.mirror_input.set_value('github'))

        btn_proxy = gui.Button('Proxy', width='80px', height='30px')
        btn_proxy.onclick.do(lambda widget: self.mirror_input.set_value('gh-proxy.org'))

        btn_gee = gui.Button('Gee', width='80px', height='30px')
        btn_gee.onclick.do(lambda widget: self.mirror_input.set_value('ghfile.geekertao.top'))

        btn_set_mirror = gui.Button('应用镜像设置', width='150px', height='35px')
        btn_set_mirror.onclick.do(self.set_mirror)

        mirror_buttons.append(gui.Label('快速选择:'))
        mirror_buttons.append(gui.Label('', width='5px'))
        mirror_buttons.append(btn_github)
        mirror_buttons.append(gui.Label('', width='5px'))
        mirror_buttons.append(btn_proxy)
        mirror_buttons.append(gui.Label('', width='5px'))
        mirror_buttons.append(btn_gee)

        mirror_controls = gui.VBox(width='100%', height='auto', style={'margin-top': '10px'})
        mirror_row1 = gui.HBox(width='100%', height='auto')
        mirror_row1.append(gui.Label('镜像源:'))
        mirror_row1.append(gui.Label('', width='10px'))
        mirror_row1.append(self.mirror_input)

        mirror_controls.append(mirror_row1)
        mirror_controls.append(mirror_buttons)
        mirror_controls.append(gui.Label('', height='10px'))
        mirror_controls.append(btn_set_mirror)

        mirror_container.append(mirror_title)
        mirror_container.append(mirror_controls)

        # SillyTavern 配置
        st_config_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px', 'margin-bottom': '20px'})
        st_config_title = gui.Label('SillyTavern 配置', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        self.port_input = gui.TextInput(width='100px')
        self.port_input.set_value(str(self.launcher.stCfg.port) if hasattr(self.launcher.stCfg, 'port') else "8000")

        self.listen_checkbox = gui.CheckBox(label='监听所有地址')
        self.listen_checkbox.set_value(getattr(self.launcher.stCfg, 'listen', False))

        st_config_controls = gui.VBox(width='100%', height='auto')

        port_row = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        port_row.append(gui.Label('端口:'))
        port_row.append(gui.Label('', width='10px'))
        port_row.append(self.port_input)

        listen_row = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        listen_row.append(self.listen_checkbox)

        btn_save_st_config = gui.Button('保存 SillyTavern 配置', width='200px', height='35px')
        btn_save_st_config.onclick.do(self.save_st_config)

        st_config_controls.append(port_row)
        st_config_controls.append(listen_row)
        st_config_controls.append(gui.Label('', height='10px'))
        st_config_controls.append(btn_save_st_config)

        st_config_container.append(st_config_title)
        st_config_container.append(st_config_controls)

        # 组装配置选项卡
        container.append(mirror_container)
        container.append(st_config_container)

        return container

    def create_sync_tab(self):
        """创建数据同步选项卡"""
        container = gui.VBox(width='100%', height='100%', style={'padding': '10px'})

        # 同步服务器控制
        sync_server_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px', 'margin-bottom': '20px'})
        sync_server_title = gui.Label('同步服务器控制', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        # 端口和主机配置
        port_row = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        port_row.append(gui.Label('端口:'))
        port_row.append(gui.Label('', width='10px'))
        self.sync_port_input = gui.TextInput(width='100px')
        self.sync_port_input.set_value(str(self.launcher.config_manager.get("sync.port", 9999)))
        port_row.append(self.sync_port_input)

        host_row = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        host_row.append(gui.Label('主机地址:'))
        host_row.append(gui.Label('', width='10px'))
        self.sync_host_input = gui.TextInput(width='200px')
        self.sync_host_input.set_value(self.launcher.config_manager.get("sync.host", "0.0.0.0"))
        host_row.append(self.sync_host_input)

        # 控制按钮
        btn_start_sync = gui.Button('启动同步服务器', width='150px', height='35px', style={'background-color': '#4CAF50', 'color': 'white'})
        btn_start_sync.onclick.do(self.start_sync_server)

        btn_stop_sync = gui.Button('停止同步服务器', width='150px', height='35px', style={'background-color': '#f44336', 'color': 'white'})
        btn_stop_sync.onclick.do(self.stop_sync_server)

        sync_controls = gui.HBox(width='100%', height='auto', style={'margin-top': '15px'})
        sync_controls.append(btn_start_sync)
        sync_controls.append(gui.Label('', width='10px'))
        sync_controls.append(btn_stop_sync)

        # 同步服务器状态
        self.sync_status_label = gui.Label('状态: 未知', style={'margin-top': '10px'})

        sync_server_container.append(sync_server_title)
        sync_server_container.append(port_row)
        sync_server_container.append(host_row)
        sync_server_container.append(sync_controls)
        sync_server_container.append(self.sync_status_label)

        # 客户端同步
        sync_client_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px'})
        sync_client_title = gui.Label('从服务器同步数据', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        server_url_row = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        server_url_row.append(gui.Label('服务器地址:'))
        server_url_row.append(gui.Label('', width='10px'))
        self.server_url_input = gui.TextInput(width='300px')
        self.server_url_input.set_value('http://192.168.1.100:9999')
        server_url_row.append(self.server_url_input)

        # 同步方法选择
        method_row = gui.HBox(width='100%', height='auto', style={'margin-top': '10px'})
        method_row.append(gui.Label('同步方法:'))
        method_row.append(gui.Label('', width='10px'))

        # 创建方法选择按钮
        method_buttons = gui.HBox(width='auto', height='auto')

        btn_auto = gui.Button('自动', width='60px', height='30px')
        btn_auto.onclick.do(lambda widget: self.sync_method_input.set_value('auto'))

        btn_zip = gui.Button('ZIP', width='60px', height='30px')
        btn_zip.onclick.do(lambda widget: self.sync_method_input.set_value('zip'))

        btn_incremental = gui.Button('增量', width='60px', height='30px')
        btn_incremental.onclick.do(lambda widget: self.sync_method_input.set_value('incremental'))

        method_buttons.append(btn_auto)
        method_buttons.append(gui.Label('', width='5px'))
        method_buttons.append(btn_zip)
        method_buttons.append(gui.Label('', width='5px'))
        method_buttons.append(btn_incremental)

        # 隐藏的输入框用于存储当前方法
        self.sync_method_input = gui.TextInput(width='100px', style={'display': 'none'})
        self.sync_method_input.set_value('auto')

        method_row.append(method_buttons)
        method_row.append(self.sync_method_input)

        # 备份选项
        self.backup_checkbox = gui.CheckBox(label='备份现有数据')
        self.backup_checkbox.set_value(True)

        btn_sync_from_server = gui.Button('开始同步', width='150px', height='35px', style={'background-color': '#2196F3', 'color': 'white'})
        btn_sync_from_server.onclick.do(self.sync_from_server)

        client_controls = gui.VBox(width='100%', height='auto')
        client_controls.append(server_url_row)
        client_controls.append(method_row)
        client_controls.append(gui.Label('', height='5px'))
        client_controls.append(self.backup_checkbox)
        client_controls.append(gui.Label('', height='10px'))
        client_controls.append(btn_sync_from_server)

        sync_client_container.append(sync_client_title)
        sync_client_container.append(client_controls)

        # 组装同步选项卡
        container.append(sync_server_container)
        container.append(sync_client_container)

        return container

    def create_status_tab(self):
        """创建系统状态选项卡"""
        container = gui.VBox(width='100%', height='100%', style={'padding': '10px'})

        # 系统信息
        info_container = gui.VBox(width='100%', height='auto', style={'border': '1px solid #ccc', 'border-radius': '5px', 'padding': '15px', 'margin-bottom': '20px'})
        info_title = gui.Label('系统信息', style={'font-size': '18px', 'font-weight': 'bold', 'margin-bottom': '10px'})

        self.status_text = gui.TextInput(width='100%', height='400px', multiline=True, readonly=True)
        self.update_status()

        btn_refresh_status = gui.Button('刷新状态', width='120px', height='35px')
        btn_refresh_status.onclick.do(self.update_status)

        info_container.append(info_title)
        info_container.append(self.status_text)
        info_container.append(btn_refresh_status)

        container.append(info_container)

        return container

    def create_status_bar(self):
        """创建底部状态栏"""
        status_bar = gui.HBox(width='100%', height='30px', style={'border-top': '1px solid #ccc', 'padding-top': '5px'})

        self.status_label = gui.Label('就绪', style={'font-size': '12px'})

        # 获取本地IP
        local_ip = self.launcher._get_local_ip()
        self.ip_label = gui.Label(f'本地IP: {local_ip}', style={'font-size': '12px'})

        # 当前时间
        current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        self.time_label = gui.Label(current_time, style={'font-size': '12px'})

        status_bar.append(self.status_label)
        status_bar.append(gui.Label('', width='20px'))
        status_bar.append(self.ip_label)
        status_bar.append(gui.Label('', width='20px'))
        status_bar.append(self.time_label)

        return status_bar

    def log(self, message):
        """添加日志消息"""
        current_time = datetime.now().strftime('%H:%M:%S')
        log_message = f"[{current_time}] {message}\n"
        current_text = self.log_textarea.get_value()
        self.log_textarea.set_value(current_text + log_message)

    def update_status(self, widget=None):
        """更新系统状态"""
        try:
            # 获取同步服务器状态
            sync_status = self.launcher.get_sync_server_status()

            # 获取SillyTavern安装状态
            st_dir = os.path.join(os.getcwd(), "SillyTavern")
            st_installed = os.path.exists(st_dir)

            # 获取配置信息
            config = self.launcher.config_manager.config

            # 更新状态文本
            status_info = "=== 系统状态 ===\n\n"

            # SillyTavern 状态
            status_info += f"SillyTavern 状态:\n"
            status_info += f"  已安装: {'是' if st_installed else '否'}\n"
            if hasattr(self.launcher.stCfg, 'port'):
                status_info += f"  配置端口: {self.launcher.stCfg.port}\n"
            if hasattr(self.launcher.stCfg, 'listen'):
                status_info += f"  监听所有地址: {self.launcher.stCfg.listen}\n"
            status_info += "\n"

            # 同步服务器状态
            status_info += f"同步服务器状态:\n"
            status_info += f"  运行状态: {'运行中' if sync_status['running'] else '已停止'}\n"
            status_info += f"  配置状态: {'启用' if sync_status['config_enabled'] else '禁用'}\n"
            status_info += f"  状态一致性: {'一致' if sync_status['consistent'] else '不一致'}\n"
            status_info += f"  监听端口: {sync_status['port']}\n"
            status_info += f"  监听主机: {sync_status['host']}\n"
            if sync_status['running']:
                local_ip = self.launcher._get_local_ip()
                status_info += f"  访问地址: http://{local_ip}:{sync_status['port']}\n"
            status_info += "\n"

            # GitHub 镜像配置
            status_info += f"GitHub 镜像配置:\n"
            status_info += f"  当前镜像: {config.get('github.mirror', 'github')}\n"
            status_info += "\n"

            # 自动启动配置
            status_info += f"启动配置:\n"
            status_info += f"  一键启动: {'启用' if config.get('autostart', False) else '禁用'}\n"
            status_info += "\n"

            # 数据目录信息
            data_dir = os.path.join(st_dir, "data", "default-user") if st_installed else None
            status_info += f"数据目录:\n"
            if data_dir and os.path.exists(data_dir):
                status_info += f"  路径: {data_dir}\n"
                status_info += f"  存在: 是\n"
            else:
                status_info += f"  路径: {data_dir or '未安装'}\n"
                status_info += f"  存在: 否\n"

            status_info += f"\n最后更新: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

            self.status_text.set_value(status_info)

            # 更新同步状态标签
            if sync_status['running']:
                self.sync_status_label.set_value('状态: 运行中')
                self.sync_status_label.attributes['style'] = 'color: green; font-weight: bold;'
            else:
                self.sync_status_label.set_value('状态: 已停止')
                self.sync_status_label.attributes['style'] = 'color: red; font-weight: bold;'

            # 更新时间标签
            self.time_label.set_value(datetime.now().strftime('%Y-%m-%d %H:%M:%S'))

        except Exception as e:
            self.log(f"更新状态时出错: {e}")

    def clear_log(self, widget):
        """清空日志"""
        self.log_textarea.set_value("")

    def install_sillytavern(self, widget):
        """安装 SillyTavern"""
        self.log("开始安装 SillyTavern...")

        def run_install():
            try:
                self.launcher.install_sillytavern()
                self.log("SillyTavern 安装完成")
                self.update_status()
            except Exception as e:
                self.log(f"安装失败: {e}")

        # 在后台线程运行安装
        threading.Thread(target=run_install, daemon=True).start()

    def start_sillytavern(self, widget):
        """启动 SillyTavern"""
        self.log("正在启动 SillyTavern...")

        def run_start():
            try:
                self.launcher.start_sillytavern()
            except Exception as e:
                self.log(f"启动失败: {e}")

        # 在后台线程运行启动
        threading.Thread(target=run_start, daemon=True).start()

    def update_sillytavern(self, widget):
        """更新 SillyTavern"""
        self.log("开始更新 SillyTavern...")

        def run_update():
            try:
                self.launcher.update_sillytavern()
                self.log("SillyTavern 更新完成")
                self.update_status()
            except Exception as e:
                self.log(f"更新失败: {e}")

        # 在后台线程运行更新
        threading.Thread(target=run_update, daemon=True).start()

    def toggle_autostart(self, widget, value):
        """切换自动启动设置"""
        self.launcher.config_manager.set("autostart", value)
        self.launcher.config_manager.save_config()
        self.log(f"一键启动模式: {'启用' if value else '禁用'}")

    def update_launcher(self, widget):
        """更新启动器"""
        self.log("开始更新启动器...")

        def run_update():
            try:
                self.launcher.update_launcher()
                self.log("启动器更新完成")
                self.update_status()
            except Exception as e:
                self.log(f"更新失败: {e}")

        # 在后台线程运行更新
        threading.Thread(target=run_update, daemon=True).start()

    def restart_launcher(self, widget):
        """重启启动器"""
        self.log("正在重启启动器...")

        def run_restart():
            time.sleep(1)  # 给用户时间看到消息
            # 获取当前的参数
            args = sys.argv[1:] if len(sys.argv) > 1 else []
            # 重新执行脚本
            os.execv(sys.executable, [sys.executable] + [sys.argv[0]] + args)

        threading.Thread(target=run_restart, daemon=True).start()

    def set_mirror(self, widget):
        """设置GitHub镜像"""
        mirror_value = self.mirror_input.get_value().strip()

        if mirror_value:
            self.launcher.set_github_mirror(mirror_value)
            self.log(f"GitHub 镜像已设置为: {mirror_value}")
            self.update_status()
        else:
            self.log("错误: 镜像源不能为空")

    def save_st_config(self, widget):
        """保存 SillyTavern 配置"""
        try:
            port = int(self.port_input.get_value())
            listen = self.listen_checkbox.get_value()

            # 更新配置
            self.launcher.stCfg.port = port
            self.launcher.stCfg.listen = listen

            # 保存配置到文件
            self.launcher.stCfg.save()

            self.log(f"SillyTavern 配置已保存: 端口={port}, 监听所有地址={listen}")
            self.update_status()

        except ValueError:
            self.log("错误: 端口号必须是数字")
        except Exception as e:
            self.log(f"保存配置失败: {e}")

    def start_sync_server(self, widget):
        """启动同步服务器"""
        try:
            port = int(self.sync_port_input.get_value())
            host = self.sync_host_input.get_value()

            self.log(f"正在启动同步服务器 (端口: {port}, 主机: {host})...")

            def run_start():
                success = self.launcher.start_sync_server(port, host)
                if success:
                    self.log("同步服务器启动成功")
                    self.update_status()
                else:
                    self.log("同步服务器启动失败")

            threading.Thread(target=run_start, daemon=True).start()

        except ValueError:
            self.log("错误: 端口号必须是数字")
        except Exception as e:
            self.log(f"启动同步服务器失败: {e}")

    def stop_sync_server(self, widget):
        """停止同步服务器"""
        self.log("正在停止同步服务器...")

        def run_stop():
            self.launcher.stop_sync_server()
            self.log("同步服务器已停止")
            self.update_status()

        threading.Thread(target=run_stop, daemon=True).start()

    def sync_from_server(self, widget):
        """从服务器同步数据"""
        server_url = self.server_url_input.get_value()
        if not server_url:
            self.log("错误: 请输入服务器地址")
            return

        # 获取同步方法
        method = self.sync_method_input.get_value()
        if not method:
            method = 'auto'  # 默认方法

        backup = self.backup_checkbox.get_value()

        self.log(f"开始从服务器同步数据: {server_url} (方法: {method}, 备份: {backup})")

        def run_sync():
            try:
                success = self.launcher.sync_from_server(server_url, method, backup)
                if success:
                    self.log("数据同步完成")
                    self.update_status()
                else:
                    self.log("数据同步失败")
            except Exception as e:
                self.log(f"同步过程中出错: {e}")

        threading.Thread(target=run_sync, daemon=True).start()


def start_webui(host='127.0.0.1', port=8080, **kwargs):
    """启动WebUI"""
    print(f"正在启动 SillyTavern WebUI...")
    print(f"访问地址: http://{host}:{port}")

    # 启动REMI服务器
    start(
        SillyTavernWebUI,
        address=host,
        port=port,
        multiple_instance=False,
        enable_file_cache=True,
        **kwargs
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SillyTavern WebUI")
    parser.add_argument("--host", default="127.0.0.1", help="服务器主机地址 (默认: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="服务器端口 (默认: 8080)")
    parser.add_argument("--debug", action="store_true", help="启用调试模式")

    args = parser.parse_args()

    try:
        start_webui(
            host=args.host,
            port=args.port,
            start_browser=args.debug
        )
    except KeyboardInterrupt:
        print("\nWebUI 已停止")
    except Exception as e:
        print(f"启动 WebUI 失败: {e}")
        sys.exit(1)