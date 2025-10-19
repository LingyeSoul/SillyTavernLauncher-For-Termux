#!/bin/bash

# SillyTavern Launcher for Termux - 安装脚本 (中国大陆优化版)
# 用于在Termux环境中快速安装和配置SillyTavern Launcher CLI

echo "========================================="
echo "SillyTavern Launcher for Termux 安装脚本 (中国大陆优化版)"
echo "========================================="

# 检查是否在Termux环境中
if [ ! -d "$HOME/.termux" ]; then
    echo "错误: 此脚本只能在Termux环境中运行"
    echo "请在Android设备上的Termux应用中运行此脚本"
    exit 1
fi

# 更新包管理器 (使用清华镜像源)
echo "正在配置清华镜像源..."
mkdir -p $HOME/.termux
echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main" > $HOME/.termux/sources.list

echo "正在更新包管理器..."
pkg update -y

# 安装必要的包
echo "正在安装必要的包..."
pkg install -y python nodejs-lts git

# 创建项目目录
echo "正在创建项目目录..."
mkdir -p /SillytavernLauncher

# 进入项目目录
cd /SillytavernLauncher

# 克隆项目文件 (使用Gitee镜像)
echo "正在克隆 SillyTavern Launcher 仓库 (Gitee镜像)..."
git clone https://gitee.com/lingyesoul/SillyTavernLauncher-For-Termux.git .
if [ $? -ne 0 ]; then
    echo "错误: 克隆仓库失败"
    exit 1
fi

# 创建虚拟环境
echo "正在创建Python虚拟环境..."
python -m venv venv
source venv/bin/activate

# 配置pip使用清华镜像源
echo "正在配置pip镜像源..."
mkdir -p $HOME/.pip
cat > $HOME/.pip/pip.conf << EOF
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple/
[install]
trusted-host = pypi.tuna.tsinghua.edu.cn
EOF

# 安装Python依赖
echo "正在安装Python依赖..."
pip install aiohttp==3.12.4 ruamel.yaml packaging

# 创建启动脚本
echo "正在创建启动脚本..."
cat > start.sh << 'EOF'
#!/bin/bash
cd /SillytavernLauncher
source venv/bin/activate
python src/main_cli.py "$@"
EOF

chmod +x start.sh

# 创建桌面快捷方式或别名
echo "正在创建别名..."
echo "alias st='cd /SillytavernLauncher && source venv/bin/activate && python src/main_cli.py'" >> $HOME/.bashrc
echo "alias ST='cd /SillytavernLauncher && source venv/bin/activate && python src/main_cli.py'" >> $HOME/.bashrc

echo "========================================="
echo "安装完成!"
echo ""
echo "请执行以下命令加载环境变量:"
echo "  source ~/.bashrc"
echo ""
echo "然后可以使用以下命令之一启动程序:"
echo "  st --help"
echo "  ST --help"
echo ""
echo "或者直接运行:"
echo "  ./start.sh --help"
echo "========================================="