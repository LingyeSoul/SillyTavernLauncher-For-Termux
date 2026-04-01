#!/bin/bash

# SillyTavernLauncher for Termux - 安装脚本 (中国大陆优化版)
# 用于在Termux环境中快速安装和配置SillyTavernLauncher CLI
#
# 使用方法:
#   bash install_termux_cn.sh           # 使用默认 gh-proxy.org 镜像
#   bash install_termux_cn.sh github     # 使用官方 GitHub
#   bash install_termux_cn.sh ghproxy    # 使用 gh-proxy.org
#   bash install_termux_cn.sh ghllkk     # 使用 gh.llkk.cc

echo "========================================="
echo "SillyTavernLauncher for Termux 安装脚本 (中国大陆优化版)"
echo "========================================="

# 检查是否在Termux环境中
if [ ! -d "$HOME/.termux" ]; then
    echo "错误: 此脚本只能在Termux环境中运行"
    echo "请在Android设备上的Termux应用中运行此脚本"
    exit 1
fi

# 解析镜像参数 (默认使用 gh-proxy.org)
MIRROR="${1:-ghproxy}"

# 配置 GitHub 镜像源 URL
case "$MIRROR" in
    github)
        GITHUB_BASE="https://github.com"
        RAW_BASE="https://raw.githubusercontent.com"
        echo "使用官方 GitHub 源"
        ;;
    ghproxy)
        GITHUB_BASE="https://gh-proxy.org/https://github.com"
        RAW_BASE="https://gh-proxy.org/https://raw.githubusercontent.com"
        echo "使用 gh-proxy.org 镜像"
        ;;
    ghllkk)
        GITHUB_BASE="https://gh.llkk.cc/https://github.com"
        RAW_BASE="https://gh.llkk.cc/https://raw.githubusercontent.com"
        echo "使用 gh.llkk.cc 镜像"
        ;;
    *)
        echo "错误: 未知镜像源 $MIRROR"
        echo "支持的镜像源: github, ghproxy, ghllkk"
        exit 1
        ;;
esac

# GitHub 仓库信息
GITHUB_ORG="LingyeSoul"
GITHUB_REPO="SillyTavernLauncher-For-Termux"
REPO_URL="${GITHUB_BASE}/${GITHUB_ORG}/${GITHUB_REPO}.git"
INSTALL_SCRIPT_URL="${RAW_BASE}/${GITHUB_ORG}/${GITHUB_REPO}/main/install_termux_cn.sh"

# 更新包管理器 (使用清华镜像源 + 阿里云镜像源)
echo "正在配置国内镜像源 (清华为主，阿里云为辅)..."
sed -i 's@^\(deb.*stable main\)$@#\1\ndeb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main\ndeb https://mirrors.aliyun.com/termux/termux-packages-24 stable main@' $PREFIX/etc/apt/sources.list
apt update

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

# 克隆项目文件 (使用配置的镜像源)
echo "正在克隆 SillyTavernLauncher 仓库..."
if [ -d ".git" ]; then
    echo "目录中已存在Git仓库，正在更新..."
    git pull
else
    git clone "$REPO_URL" .
    if [ $? -ne 0 ]; then
        echo "错误: 克隆仓库失败"
        exit 1
    fi
fi

# 创建虚拟环境
echo "正在创建Python虚拟环境..."
python -m venv venv
source venv/bin/activate

# 配置pip使用国内镜像源 (清华为主，其他为备选)
echo "正在配置pip镜像源..."
mkdir -p $HOME/.pip
cat > $HOME/.pip/pip.conf << EOF
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple/
extra-index-url =
    http://mirrors.aliyun.com/pypi/simple/
    https://mirrors.ustc.edu.cn/pypi/simple/
    https://repo.huaweicloud.com/repository/pypi/simple/
    https://mirrors.cloud.tencent.com/pypi/simple/
[install]
trusted-host =
    pypi.tuna.tsinghua.edu.cn
    mirrors.aliyun.com
    mirrors.ustc.edu.cn
    repo.huaweicloud.com
    mirrors.cloud.tencent.com
EOF

# 安装Python依赖
echo "正在安装Python依赖..."
# 优先从requirements.txt安装，确保版本一致性
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
else
    # 备用方案：安装核心依赖和同步服务器依赖
    pip install ruamel.yaml flask requests
fi

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
# 确保 .bashrc 存在
if [ ! -f "$HOME/.bashrc" ]; then
    touch "$HOME/.bashrc"
fi

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

echo "========================================="
echo "现在可以使用以下命令:"
echo "  st             (进入菜单界面)"
echo "  st menu        (进入菜单界面)"
echo "  st --help      (查看帮助信息)"
echo "  ST --help      (查看帮助信息)"
echo "  st update-launcher (更新SillyTavernLauncher)"
echo ""
echo "========================================="

# 退出虚拟环境
deactivate
