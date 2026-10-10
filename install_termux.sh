#!/bin/bash

# SillyTavernLauncher for Termux - 安装脚本 (Node.js/TypeScript 版)
# 依赖: nodejs-lts (>= 22.12) + git，不再需要 Python

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

# 安装必要的包（SillyTavern 本身也运行在 Node 上，启动器与其共用同一运行时）
echo "正在安装必要的包..."
pkg install -y nodejs-lts git

# 检查 Node 版本 (>= 22.12，需要原生 TypeScript 支持与 Vite 7 构建链)
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
    echo "错误: 需要 Node.js >= 22.12 (当前 $(node -v))"
    echo "请运行: pkg install nodejs-lts 后重试"
    exit 1
fi

# 创建项目目录
echo "正在创建项目目录..."
ST_LAUNCHER_DIR="$HOME/SillytavernLauncher"
mkdir -p "$ST_LAUNCHER_DIR"
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

# 安装依赖（含 WEBUI 前端构建工具链，运行时仍零依赖）
echo "正在安装 Node.js 依赖..."
npm install --no-audit --no-fund
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
sed -i '/alias st=/d' $HOME/.bashrc
sed -i '/alias ST=/d' $HOME/.bashrc
sed -i '/alias stl=/d' $HOME/.bashrc

echo "alias st='$HOME/SillyTavernLauncher/st'" >> $HOME/.bashrc
echo "alias ST='$HOME/SillytavernLauncher/st'" >> $HOME/.bashrc

export PATH="$HOME/SillytavernLauncher:$PATH"

echo "========================================="
echo "安装完成!"
echo ""
echo "现在可以使用以下命令:"
echo "  st          (进入菜单界面 / 一键启动)"
echo "  st webui    (启动 WebUI 管理界面)"
echo "  webui       (同上)"
echo "  st --help   (查看帮助)"
echo ""
echo "首次使用会要求同意用户协议。"
echo "========================================="

source ~/.bashrc
