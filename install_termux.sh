#!/bin/bash

# SillyTavernLauncher for Termux - 安装脚本
# 用于在Termux环境中快速安装和配置SillyTavernLauncher CLI

echo "========================================="
echo "SillyTavernLauncher for Termux 安装脚本"
echo "========================================="

# 检查是否在Termux环境中
if [ ! -d "$HOME/.termux" ]; then
    echo "错误: 此脚本只能在Termux环境中运行"
    echo "请在Android设备上的Termux应用中运行此脚本"
    exit 1
fi

# 更新包管理器
echo "正在更新包管理器..."
pkg update -y

# 安装必要的包
echo "正在安装必要的包..."
pkg install -y python nodejs-lts git

# 创建项目目录 (使用用户主目录而不是根目录)
echo "正在创建项目目录..."
ST_LAUNCHER_DIR="$HOME/SillytavernLauncher"
mkdir -p "$ST_LAUNCHER_DIR"

# 进入项目目录
cd "$ST_LAUNCHER_DIR"

# 克隆项目文件
echo "正在克隆 SillyTavernLauncher 仓库..."
if [ -d ".git" ]; then
    echo "目录中已存在Git仓库，正在更新..."
    git pull
else
    git clone https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux.git .
    if [ $? -ne 0 ]; then
        echo "错误: 克隆仓库失败"
        exit 1
    fi
fi

# 创建虚拟环境
echo "正在创建Python虚拟环境..."
python -m venv venv
source venv/bin/activate

# 安装Python依赖
echo "正在安装Python依赖..."
pip install aiohttp==3.12.4 ruamel.yaml packaging

# 创建启动脚本
echo "正在创建启动脚本..."
cat > start.sh << 'EOF'
#!/bin/bash
cd "$HOME/SillytavernLauncher"
source venv/bin/activate
python src/main_cli.py "$@"
EOF

chmod +x start.sh

# 创建简化启动脚本
echo "正在创建简化启动脚本..."
cat > st << 'EOF'
#!/bin/bash
cd "$HOME/SillytavernLauncher"
source venv/bin/activate
python src/main_cli.py "$@"
EOF

chmod +x st


# 创建桌面快捷方式或别名
echo "正在创建别名..."
# 先清空可能已有的相关别名
sed -i '/alias st=/d' $HOME/.bashrc
sed -i '/alias ST=/d' $HOME/.bashrc
sed -i '/alias stl=/d' $HOME/.bashrc

echo "alias st='$HOME/SillytavernLauncher/st'" >> $HOME/.bashrc
echo "alias ST='$HOME/SillytavernLauncher/st'" >> $HOME/.bashrc

# 确保脚本在当前会话中可用
export PATH="$HOME/SillytavernLauncher:$PATH"

echo "========================================="
echo "安装完成!"
echo ""
echo "正在自动加载环境变量..."
source ~/.bashrc

# 自动启动 SillyTavern
echo "正在自动启动 SillyTavern..."
cd "$ST_LAUNCHER_DIR"
source venv/bin/activate
python src/main_cli.py launch

echo ""
echo "现在可以使用以下命令:"
echo "  st             (进入菜单界面)"
echo "  st menu        (进入菜单界面)"
echo "  st --help      (查看帮助信息)"
echo "  ST --help      (查看帮助信息)"
echo "  st update-launcher (更新SillyTavernLauncher)"
echo ""
echo "或者直接运行:"
echo "  ./start.sh --help"
echo "========================================="