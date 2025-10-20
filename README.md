# SillyTavernLauncher for Termux 使用指南

本指南将帮助你在 Android 设备的 Termux 环境中安装和使用 SillyTavernLauncher Termux 版本。

## 新功能

- 启动 SillyTavern 时如果未安装会自动询问是否安装
- 支持多种 GitHub 镜像站点以提高下载速度
- 支持配置 NPM 镜像源以加快依赖安装

## 一键安装

### 国际用户一键安装

在 Termux 中执行以下命令即可一键安装：

```bash
curl -s https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh | bash
```

### 中国大陆用户一键安装

中国大陆用户可以使用以下命令进行一键安装（使用Gitee镜像加速）：

```bash
curl -s https://gitee.com/lingyesoul/SillyTavernLauncher-For-Termux/raw/main/install_termux_cn.sh | bash
```

安装完成后，执行 `source ~/.bashrc` 即可使用 `st` 或 `ST` 命令启动程序。

## 安装前准备

1. 在 Github或 F-Droid 中下载并安装 Termux 应用
2. 打开 Termux 应用并等待初始化完成

## 安装步骤

### 1. 设置存储权限

```bash
termux-setup-storage
```

### 2. 更新包管理器并更换镜像源（推荐）

```bash
# 更新包管理器
pkg update -y

# 更换为清华镜像源（可选但推荐）
termux-change-repo
# 选择清华镜像源以加快下载速度
```

### 3. 安装必要依赖

```bash
pkg install -y python nodejs-lts git
```

### 4. 使用一键安装脚本

项目包含安装脚本，可以自动完成安装步骤：

**国际用户：**
```bash
# 下载并运行安装脚本
curl -s https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh | bash
```

**中国大陆用户：**
```bash
# 下载并运行安装脚本 (Gitee镜像)
curl -s https://gitee.com/lingyesoul/SillyTavernLauncher-For-Termux/raw/main/install_termux_cn.sh | bash
```

### 5. 手动安装方式

```bash
# 克隆项目到当前目录
git clone https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux.git
cd SillyTavernLauncher-For-Termux
```

安装所需的 Python 依赖:
```bash
pip install ruamel.yaml packaging
```

## 使用方法

安装完成后，可以使用以下命令：

```bash
# 查看帮助
python src/main_cli.py --help

# 安装 SillyTavern
python src/main_cli.py install

# 启动 SillyTavern (如果未安装会询问是否安装)
python src/main_cli.py start

# 停止 SillyTavern
python src/main_cli.py stop

# 查看运行状态
python src/main_cli.py status

# 查看配置
python src/main_cli.py config

# 启用自启动
python src/main_cli.py autostart-enable

# 禁用自启动
python src/main_cli.py autostart-disable

# 更新 SillyTavern
python src/main_cli.py update

# 设置GitHub镜像
python src/main_cli.py set-mirror --mirror gh-proxy.com
```

## 快捷命令设置

安装脚本会自动设置别名，安装完成后执行以下命令加载环境变量：

```bash
source ~/.bashrc
```

然后可以使用以下命令：

```bash
# 使用小写别名
st --help

# 使用大写别名
ST --help
```

## 故障排除

### 1. 如果遇到依赖安装问题

```bash
# 升级 pip
pip install --upgrade pip

# 清除缓存重新安装
pip cache purge
pip install ruamel.yaml packaging
```

### 2. 如果 SillyTavern 启动失败

检查日志输出，确保：
- 所有依赖已正确安装
- 端口未被其他应用占用
- 设备有足够的存储空间

### 3. 如果遇到Git或Node.js相关错误

确保已正确安装系统依赖：
```bash
# 检查Git
git --version

# 检查Node.js
node --version

# 检查npm
npm --version
```

如果未正确安装，请重新执行安装命令：
```bash
pkg install -y git nodejs-lts
```