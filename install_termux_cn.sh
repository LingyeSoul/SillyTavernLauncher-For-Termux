#!/bin/bash

# SillyTavernLauncher for Termux - 安装脚本 (中国大陆优化版, Node.js/TypeScript)
# 依赖: nodejs-lts (>= 22.12) + git，不再需要 Python
#
# 使用方法:
#   bash install_termux_cn.sh           # 使用默认 gh-proxy.org 镜像
#   bash install_termux_cn.sh github    # 使用官方 GitHub
#   bash install_termux_cn.sh ghproxy   # 使用 gh-proxy.org
#   bash install_termux_cn.sh ghllkk    # 使用 gh.llkk.cc

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
        echo "使用官方 GitHub 源"
        ;;
    ghproxy)
        echo "使用 gh-proxy.org 镜像"
        ;;
    ghllkk)
        echo "使用 gh.llkk.cc 镜像"
        ;;
    *)
        echo "错误: 未知镜像源 $MIRROR"
        echo "支持的镜像源: github, ghproxy, ghllkk"
        exit 1
        ;;
esac

# 更新包管理器 (使用清华镜像源 + 阿里云镜像源)
echo "正在配置国内镜像源 (清华为主，阿里云为辅)..."
sed -i 's@^\(deb.*stable main\)$@#\1\ndeb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main\ndeb https://mirrors.aliyun.com/termux/termux-packages-24 stable main@' $PREFIX/etc/apt/sources.list
apt update

echo "正在更新包管理器..."
pkg update -y

# 安装必要的包
echo "正在安装必要的包..."
pkg install -y nodejs-lts git

# 检查 Node 版本 (>= 22.12，需要原生 TypeScript 支持与 Vite 7 构建链)
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
    echo "错误: 需要 Node.js >= 22.12 (当前 $(node -v))"
    exit 1
fi

# 创建项目目录
echo "正在创建项目目录..."
ST_LAUNCHER_DIR="$HOME/SillytavernLauncher"
mkdir -p "$ST_LAUNCHER_DIR"
cd "$ST_LAUNCHER_DIR"

# 配置 Git 全局镜像
echo "正在配置 Git 全局镜像..."
git config --global --unset-all url.https://github.com/.insteadof 2>/dev/null
case "$MIRROR" in
    github)
        echo "使用官方 GitHub 源，无需配置代理"
        ;;
    ghproxy)
        git config --global url.https://gh-proxy.org/https://github.com/.insteadof https://github.com/
        echo "Git 全局镜像已配置: gh-proxy.org"
        ;;
    ghllkk)
        git config --global url.https://gh.llkk.cc/https://github.com/.insteadof https://github.com/
        echo "Git 全局镜像已配置: gh.llkk.cc"
        ;;
esac

# 克隆项目文件 (官方 URL 会被 gitconfig insteadOf 自动重写为镜像地址)
echo "正在克隆 SillyTavernLauncher 仓库..."
if [ -d ".git" ]; then
    echo "目录中已存在Git仓库，正在更新..."
    git pull
else
    git clone "https://github.com/LingyeSoul/SillyTavernLauncher-For-Termux.git" .
    if [ $? -ne 0 ]; then
        echo "错误: 克隆仓库失败"
        exit 1
    fi
fi

# 安装依赖（使用 npmmirror 国内镜像，含 WEBUI 前端构建工具链，运行时仍零依赖）
echo "正在安装 Node.js 依赖 (npmmirror 镜像)..."
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
if [ $? -ne 0 ]; then
    echo "错误: 依赖安装失败"
    exit 1
fi

# 构建 WEBUI 前端（Vuetify 4 产物输出到 src/webui/public，设备端构建）
echo "正在构建 WEBUI 前端..."
npm run build:webui
if [ $? -ne 0 ]; then
    echo "错误: WEBUI 前端构建失败"
    exit 1
fi

# 创建启动脚本
echo "正在创建启动脚本..."
cat > st << 'EOF'
#!/bin/bash
cd "$HOME/SillytavernLauncher"
exec node --experimental-strip-types src/cli.ts "$@"
EOF
chmod +x st

cat > webui << 'EOF'
#!/bin/bash
cd "$HOME/SillytavernLauncher"
exec node --experimental-strip-types src/webui.ts "$@"
EOF
chmod +x webui

# 创建别名
echo "正在创建别名..."
if [ ! -f "$HOME/.bashrc" ]; then
    touch "$HOME/.bashrc"
fi
sed -i '/alias st=/d' $HOME/.bashrc
sed -i '/alias ST=/d' $HOME/.bashrc
sed -i '/alias stl=/d' $HOME/.bashrc

echo "alias st='$HOME/SillytavernLauncher/st'" >> $HOME/.bashrc
echo "alias ST='$HOME/SillyTavernLauncher/st'" >> $HOME/.bashrc

export PATH="$HOME/SillytavernLauncher:$PATH"

echo "========================================="
echo "安装完成!"
echo ""
source ~/.bashrc
echo "现在可以使用以下命令:"
echo "  st          (进入菜单界面 / 一键启动)"
echo "  st webui    (启动 WebUI 管理界面)"
echo "  webui       (同上)"
echo "  st --help   (查看帮助)"
echo ""
echo "首次使用会要求同意用户协议。"
echo "========================================="
