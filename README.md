# SillyTavern Launcher for Termux 使用指南

本指南将帮助你在 Android 设备的 Termux 环境中安装和使用 SillyTavern Launcher CLI 版本。

## 安装前准备

1. 在 Google Play 或 F-Droid 中下载并安装 Termux 应用
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

项目包含一个安装脚本 [install_termux.sh](file:///e:/WorkProject/SillyTavernLauncher-For-Termux/install_termux.sh)，可以自动完成安装步骤：

```bash
# 下载并运行安装脚本
curl -s https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh | bash
```

或者分步执行：

```bash
# 下载安装脚本
wget https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh

# 运行安装脚本
bash install_termux.sh
```

### 5. 手动安装方式

```bash
# 克隆项目到指定目录
git clone https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux.git /SillytavernLauncher
cd /SillytavernLauncher

# 创建Python虚拟环境
python -m venv venv
source venv/bin/activate

# 安装Python依赖
pip install -r requirements.txt
```

## 使用方法

激活虚拟环境后，可以使用以下命令：

```bash
# 查看帮助
python src/main_cli.py --help

# 安装 SillyTavern
python src/main_cli.py install

# 启动 SillyTavern
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

## CLI程序特点

与Windows版本的GUI程序不同，CLI版本具有以下特点：

1. 完全基于命令行界面，适合在Termux等终端环境中使用
2. 不再依赖内置环境，而是使用系统安装的Git和Node.js
3. 保持了核心功能：
   - 安装SillyTavern
   - 启动/停止SillyTavern服务
   - 配置管理
   - 自启动设置
   - 更新功能

## 注意事项

1. 在 Android 设备上运行 Node.js 应用可能需要较高性能，建议在中高端设备上使用
2. 首次运行 SillyTavern 时可能需要下载大量依赖，请确保网络连接稳定
3. 如果遇到权限问题，可以尝试在 Termux 中执行 `termux-setup-storage`
4. 为了获得更好的性能和稳定性，建议在设备充电时运行 SillyTavern
5. CLI版本不包含托盘功能，因为终端环境不支持

## 故障排除

### 1. 如果遇到依赖安装问题

```bash
# 升级 pip
pip install --upgrade pip

# 清除缓存重新安装
pip cache purge
pip install -r requirements.txt
```

### 2. 如果 SillyTavern 启动失败

检查日志输出，确保：
- 所有依赖已正确安装
- 端口未被其他应用占用
- 设备有足够的存储空间

### 3. 如果需要后台运行

可以使用 `nohup` 命令让程序在后台运行：

```bash
nohup python src/main_cli.py start > sillytavern.log 2>&1 &
```

查看日志：
```bash
tail -f sillytavern.log
```

停止后台运行的程序：
```bash
kill $(ps aux | grep '[m]ain_cli.py' | awk '{print $2}')
```

### 4. 如果遇到Git或Node.js相关错误

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