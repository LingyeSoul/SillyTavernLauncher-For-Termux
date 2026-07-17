# SillyTavernLauncher for Termux

一个为在 Android Termux 环境中运行 SillyTavern 而设计的命令行启动器。

# 📜 免责声明与合规说明
SillyTavernLauncher 仅为 SillyTavern 应用的启动管理工具（GUI 启动器），不涉及任何内容生成、提示词修改或内容审核功能，不参与主程序任何核心功能的运行，本项目本身不参与任何信息内容的生成、存储、传播环节。通过本启动器使用 SillyTavern 时，用户须严格遵守《中华人民共和国网络安全法》《生成式人工智能服务管理暂行办法》等国家相关法律法规，同时遵守 SillyTavern 主程序的用户协议，确保生成和传播的内容合法合规，严禁利用本工具规避合规要求，严禁用于生成或传播淫秽色情、暴力恐怖、赌博诈骗、造谣传谣等违法不良信息。作为工具提供方，我们不对用户通过本启动器使用 SillyTavern 所产生的任何内容承担法律责任，内容安全、信息合规等相关责任完全由用户自行承担。关于日志功能：本启动器的日志记录功能仅用于技术故障排查、运行状态监控、功能优化，日志收集的范围严格限定为 SillyTavern 软件运行层面的技术数据（如进程 ID、接口调用记录、错误代码、系统环境参数等），不主动收集任何用户的隐私信息、内容交互数据（如聊天内容）、身份信息（如账号、手机号）；日志数据默认存储在用户本地设备指定目录（启动器路径/logs/），仅保存在用户本地，本启动器不会主动上传、同步、分享日志数据至任何第三方服务器，用户可随时删除；用户使用日志功能时，应严格遵守相关法律法规，不得利用日志功能收集、存储、传播他人的隐私信息、敏感个人信息或用于非法用途。请用户在使用过程中自觉履行网络安全义务，遵守公序良俗，共同维护清朗网络环境。

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
source <(curl -s https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh)
```

### 中国大陆用户

```bash
source <(curl -s https://gh-proxy.org/https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux_cn.sh)
```

或者指定镜像源：
```bash
# 使用 gh-proxy.org 镜像
source <(curl -s https://gh-proxy.org/https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux_cn.sh) ghproxy

# 使用 gh.llkk.cc 镜像
source <(curl -s https://gh-proxy.org/https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux_cn.sh) ghllkk
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
- `st sync info` - 显示同步状态和当前分享地址
- `st sync rotate-token` - 轮换同步认证令牌，使旧分享地址立即失效
- `st sync from --server-url <分享URL>` - 从服务器同步数据
- `st sync menu` - 进入数据同步菜单

同步服务器启动后会显示形如 `http://192.168.1.10:9999#token=...` 的分享地址。令牌放在 URL fragment 中，不会进入 HTTP 请求日志；除 `/health` 外的接口都要求该令牌。请将完整分享地址传给另一台设备：

```bash
st sync from --server-url 'http://192.168.1.10:9999#token=...'
```

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
2. gh-proxy.org
3. gh.llkk.cc

使用 `st set-mirror --mirror <mirror>` 命令切换镜像源。


## 许可证

MIT