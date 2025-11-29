# SillyTavernLauncher for Termux

一个为在 Android Termux 环境中运行 SillyTavern 而设计的命令行启动器。

## 功能特性

- 一键安装 SillyTavern
- 启动/停止 SillyTavern 服务
- 查看运行状态与配置信息
- 启用/禁用一键启动功能
- 更新 SillyTavern 到最新版本
- 更新 SillyTavernLauncher 本身
- 支持 GitHub 镜像加速（特别针对中国大陆用户）
- **🆕 跨设备数据同步功能** (Windows PC ↔ Android Termux)

## 安装方式

### 国际用户

```bash
curl -s https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh | bash
```

### 中国大陆用户

```bash
curl -s https://gitee.com/lingyesoul/SillyTavernLauncher-For-Termux/raw/main/install_termux_cn.sh | bash
```

## 使用方法

安装完成后，可以使用以下命令：

- `st` - 进入交互式菜单（默认）或直接启动SillyTavern（启用一键启动功能后）
- `st menu` - 进入交互式菜单
- `st install` - 安装 SillyTavern
- `st start` - 启动 SillyTavern
- `st launch` - 一键启动 SillyTavern（安装+启动）
- `st update [component]` - 更新组件，component可以是 st（SillyTavern）或 stl（SillyTavernLauncher）
- `st config` - 显示当前配置
- `st autostart enable/disable` - 启用/禁用一键启动功能（输入st直接启动SillyTavern）
- `st set-mirror --mirror <mirror>` - 设置 GitHub 镜像
- `st sync start` - 启动数据同步服务器
- `st sync stop` - 停止数据同步服务器
- `st sync from --server-url <URL>` - 从服务器同步数据
- `st sync menu` - 进入数据同步菜单

### 一键启动功能

启用一键启动功能后，输入 `st` 将直接启动 SillyTavern 而不是显示菜单：
```bash
st autostart enable   # 启用一键启动
st autostart disable  # 禁用一键启动
```

### 更新命令

使用 update 命令更新不同组件：
```bash
st update st   # 更新 SillyTavern
st update stl  # 更新 SillyTavernLauncher 本身
```

当不带参数运行 `st update` 时，程序会询问要更新的内容：
1. 更新 SillyTavern
2. 更新 SillyTavernLauncher
3. 更新所有内容

### 可用的 GitHub 镜像

1. github.com (官方源)
2. gh-proxy.com
3. ghfile.geekertao.top
4. gh.dpik.top
5. github.dpik.top
6. github.acmsz.top
7. git.yylx.win

中国大陆用户安装时会自动设置为 `gh-proxy.com` 镜像以加速下载。

