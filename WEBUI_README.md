# SillyTavern WebUI 使用说明

## 概述

本项目新增了基于 REMI 的 WebUI 功能，提供图形化界面来管理 SillyTavern，无需使用命令行操作。

## 功能特性

### 主控制面板
- ✅ 安装 SillyTavern
- ✅ 启动 SillyTavern
- ✅ 更新 SillyTavern
- ✅ 一键启动模式切换
- ✅ 更新启动器
- ✅ 重启启动器

### 配置管理
- ✅ GitHub 镜像源配置
- ✅ SillyTavern 端口设置
- ✅ 监听地址配置
- ✅ 配置保存和加载

### 数据同步
- ✅ 启动/停止同步服务器
- ✅ 从远程服务器同步数据
- ✅ 同步方法选择（自动/ZIP/增量）
- ✅ 数据备份选项

### 系统状态
- ✅ 实时状态监控
- ✅ 系统信息显示
- ✅ 配置状态检查
- ✅ 服务状态查看

## 安装依赖

```bash
# 安装 WebUI 所需的依赖
pip install remi

# 或者安装所有依赖
pip install -r requirements.txt
```

## 使用方法

### 方法一：通过主菜单启动

```bash
# 运行启动器
python src/main_cli.py

# 然后选择选项 10 - 启动 WebUI (新版)
```

### 方法二：Windows 用户（最简单）

```bash
# 双击运行批处理文件
run_webui.bat
```

### 方法三：独立启动脚本

```bash
# 使用独立启动脚本
python src/webui_standalone.py

# 或者使用快速启动脚本
python start_webui.py
```

### 方法四：直接运行 WebUI 模块

```bash
# 直接运行 WebUI
python src/webui.py

# 或者使用测试版本验证功能
python test_webui.py
```

### 方法五：命令行参数

```bash
# 允许远程访问
python src/webui_standalone.py --remote

# 不自动打开浏览器
python src/webui_standalone.py --no-browser

# 启用调试模式
python src/webui_standalone.py --debug

# 自定义端口
python src/webui_standalone.py --port 9999
```

## 访问 WebUI

1. **本地访问**: `http://localhost:8080`
2. **局域网访问**: `http://[你的IP地址]:8080` (需要使用 `--remote` 参数)
3. **Termux 内访问**: `http://127.0.0.1:8080`

## 界面介绍

WebUI 分为四个主要选项卡：

### 1. 主控制
- SillyTavern 的安装、启动、更新
- 启动器的更新和重启
- 一键启动模式设置
- 实时操作日志

### 2. 配置管理
- GitHub 镜像源选择（支持多个国内镜像）
- SillyTavern 端口和监听地址配置
- 配置的保存和应用

### 3. 数据同步
- 同步服务器启动/停止控制
- 从远程服务器同步数据
- 同步方法选择（自动优先、ZIP全量、增量）
- 数据备份选项

### 4. 系统状态
- SillyTavern 安装状态
- 同步服务器运行状态
- 配置信息概览
- 数据目录信息

## 特色功能

### 🔄 实时状态更新
- 自动刷新系统状态
- 实时显示服务运行情况
- 动态更新配置信息

### 📊 可视化操作
- 图形化按钮操作
- 下拉菜单选择配置
- 复选框设置选项

### 📝 操作日志
- 详细的操作记录
- 时间戳显示
- 可清空的日志窗口

### 🌐 网络支持
- 支持局域网访问
- 自动检测本地IP
- 浏览器自动打开

## 注意事项

1. **防火墙设置**: 如果需要局域网访问，请确保防火墙允许相应端口

2. **端口冲突**: 默认使用 8080 端口，如遇冲突可使用 `--port` 参数指定其他端口

3. **依赖安装**: 首次使用前请确保已安装 `remi` 依赖库

4. **浏览器兼容**: 推荐使用现代浏览器（Chrome、Firefox、Safari 等）

5. **移动端适配**: 界面已适配移动设备，可在手机浏览器中使用

## 故障排除

### 已修复的问题

**Q: AttributeError: module 'remi.gui' has no attribute 'TabControl'**
A: ✅ 已修复 - 将选项卡改为按钮切换方式

**Q: AttributeError: 'TextInput' object has no attribute 'append'**
A: ✅ 已修复 - 使用 `set_value()` 方法替代 `append()`

**Q: AttributeError: module 'remi.gui' has no attribute 'DropDown'**
A: ✅ 已修复 - 使用按钮组和输入框替代下拉菜单

### 常见问题

**Q: 无法访问 WebUI**
A: 检查端口是否被占用，防火墙设置是否正确

**Q: 安装 remi 失败**
A: 尝试使用国内镜像源：`pip install -i https://pypi.tuna.tsinghua.edu.cn/simple remi`

**Q: WebUI 功能无响应**
A: 检查后台日志，确保相关服务正常运行

**Q: 局域网无法访问**
A: 确保使用了 `--remote` 参数，并检查网络连接

**Q: 启动时出现编码错误**
A: ✅ 已修复 - 移除了特殊Unicode字符

### 日志查看

WebUI 提供实时日志功能，可在界面上查看所有操作的详细信息。

### 验证功能

如果 WebUI 无法正常工作，可以先运行测试版本：

```bash
python test_webui.py
```

如果测试版本能正常运行，说明基础环境没问题，可能是具体功能模块的问题。

## 更新日志

- **v1.0.0**: 初始版本，包含完整的 WebUI 功能
- 支持所有主菜单功能
- 提供图形化配置界面
- 实时状态监控
- 数据同步功能集成

## 技术栈

- **前端**: REMI (Python Web UI 框架)
- **后端**: Python + Flask (同步服务器)
- **样式**: CSS + HTML
- **部署**: 内置 HTTP 服务器

---

享受使用 SillyTavern WebUI！🎉