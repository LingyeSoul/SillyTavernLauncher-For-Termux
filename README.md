# SillyTavernLauncher for Termux

在 Android Termux 上一键安装、启动、更新 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 的启动器。**Node.js/TypeScript 技术栈 + WebUI 管理界面**（自 v0.8.0 起由 Python 迁移至 Node.js，与 SillyTavern 共用同一运行时，无需再安装 Python）。

# 📜 免责声明与合规说明
SillyTavernLauncher 仅为 SillyTavern 应用的启动管理工具（启动器 + WebUI 管理界面），不涉及任何内容生成、提示词修改或内容审核功能，不参与主程序任何核心功能的运行，本项目本身不参与任何信息内容的生成、存储、传播环节。通过本启动器使用 SillyTavern 时，用户须严格遵守《中华人民共和国网络安全法》《生成式人工智能服务管理暂行办法》等国家相关法律法规，同时遵守 SillyTavern 主程序的用户协议，确保生成和传播的内容合法合规，严禁利用本工具规避合规要求，严禁用于生成或传播淫秽色情、暴力恐怖、赌博诈骗、造谣传谣等违法不良信息。作为工具提供方，我们不对用户通过本启动器使用 SillyTavern 所产生的任何内容承担法律责任，内容安全、信息合规等相关责任完全由用户自行承担。关于日志功能：本启动器的日志记录功能仅用于技术故障排查、运行状态监控、功能优化，日志收集的范围严格限定为 SillyTavern 软件运行层面的技术数据（如进程 ID、接口调用记录、错误代码、系统环境参数等），不主动收集任何用户的隐私信息、内容交互数据（如聊天内容）、身份信息（如账号、手机号）；日志数据默认存储在用户本地设备指定目录（启动器路径/logs/），仅保存在用户本地，本启动器不会主动上传、同步、分享日志数据至任何第三方服务器，用户可随时删除；用户使用日志功能时，应严格遵守相关法律法规，不得利用日志功能收集、存储、传播他人的隐私信息、敏感个人信息或用于非法用途。请用户在使用过程中自觉履行网络安全义务，遵守公序良俗，共同维护清朗网络环境。

## 功能特性

- 📱 **WebUI 管理界面** — 手机浏览器打开即用：安装/启动/停止/更新、实时日志、数据同步、配置管理、版本切换、迁移安装
- 🖥️ **完整 CLI** — `st` 交互菜单 + 全量子命令
- 一键安装 / 启动 / 停止 / 更新 SillyTavern，一键启动模式
- 🔄 **跨设备数据同步**（Windows PC ↔ Android Termux）：令牌认证的局域网同步服务器/客户端，ZIP 全量 + SHA-256 增量，事务式替换 + 自动备份回滚
- 🪞 **GitHub 镜像加速**（gh-proxy / gh.llkk / 自定义域名，gitconfig 全局重写 + npmmirror 联动）
- 🏷️ **版本管理** — SillyTavern 历史版本（tag）列表与一键切换
- ⚙️ **ST 配置管理** — config.yaml 注释保留式读写、端口/局域网监听/IP 与 Host 白名单、网段自动检测
- 📦 **迁移器** — 扫描设备上已有的 SillyTavern 安装并迁移
- 🔒 **安全基线** — 同步协议防路径穿越/防符号链接/防 ZIP 炸弹/恒时令牌比较，配置文件 0600 权限

## 安装（Termux）

### 国际用户

```bash
source <(curl -s https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux.sh)
```

### 中国大陆用户

```bash
source <(curl -s https://gh-proxy.org/https://raw.githubusercontent.com/LingyeSoul/SillyTavernLauncher-For-Termux/main/install_termux_cn.sh)
# 可选镜像参数: github | ghproxy(默认) | ghllkk
```

要求：`nodejs-lts >= 22.6` + `git`（安装脚本自动安装）。运行时 npm 依赖仅 1 个包（`yaml`），ZIP/HTTP/加密全部使用 Node 内置能力。

## 使用方法

```bash
st              # 交互菜单（或启用一键启动后直接启动 ST）
st install      # 安装 SillyTavern
st start        # 前台启动 SillyTavern
st webui        # 启动 WebUI（默认 http://127.0.0.1:8300）
```

### 命令一览

- `st menu` - 进入交互式菜单
- `st update [st|stl|dev]` - 更新 SillyTavern / 启动器 / 强制开发版
- `st config` - 显示当前配置
- `st autostart enable|disable` - 一键启动开关
- `st set-mirror <github|ghproxy|ghllkk|域名>` - 设置 GitHub 镜像
- `st sync start [--port N]` / `stop` / `info` / `rotate-token` / `menu` - 同步服务器管理
- `st sync from --server-url 'http://192.168.1.10:9999#token=...'` - 从分享地址同步数据
- `st version info|list|switch --version-str 1.5.0` - 版本管理
- `st st-config port --st-port 8000` / `listen --enable-listen` - ST 配置
- `st migrate scan` / `from --source-path <path>` - 迁移已有安装

同步服务器启动后会显示形如 `http://192.168.1.10:9999#token=...` 的分享地址。令牌放在 URL fragment 中，不会进入 HTTP 请求日志；除 `/health` 外的接口都要求该令牌。

## WebUI

`st webui` 后在手机浏览器打开 `http://127.0.0.1:8300`：

- **状态页** — 启动/停止/重启/安装/更新、访问地址与环境检测、启动器更新横幅
- **日志页** — SillyTavern 进程与任务实时日志（SSE 推送）
- **同步页** — 同步服务器启停、分享地址复制、令牌轮换、从远端拉取
- **配置页** — ST 端口/监听/白名单、GitHub 镜像切换
- **更多** — 历史版本切换、迁移扫描、依赖一键修复、启动器重启

安全边界：默认只监听 `127.0.0.1`；如配置为局域网监听（`config.json` 的 `webui.host`）会自动启用访问令牌（`webui.token`），通过 `?token=` 或 Bearer 头认证。

## 开发

```bash
npm install          # 安装依赖
npm run typecheck    # tsc --noEmit 类型门禁
npm test             # vitest（含同步安全全量测试）
npm start            # 运行 CLI
npm run webui        # 运行 WebUI
```

源码直接以 TypeScript 运行（Node ≥ 22.6 原生类型剥离，无构建步骤）。目录结构：

```
src/
├── cli.ts / webui.ts        # 入口
├── version.ts               # 版本号（自更新比对源）
├── services/                # 业务服务层（禁止依赖 UI）
│   ├── runtime.ts           # 子进程适配层（所有 spawn 的唯一出口）
│   ├── configStore.ts       # config.json 原子读写（0600）
│   ├── stLifecycle.ts       # 安装/启动/停止/更新/修复 + ST 进程管理
│   ├── gitOps.ts / versionManager.ts / migrator.ts
│   ├── mirrors.ts / network.ts / agreement.ts / stConfig.ts
│   ├── updater.ts           # 启动器自更新
│   └── sync/                # common / zip(自实现安全ZIP) / server / client / manager
└── webui/                   # WEBUI：node:http REST + SSE + 静态前端
```

## 许可证

MIT
