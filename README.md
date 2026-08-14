# Kimi Builders Usage

[简体中文](./README.md) · [English](./README.en.md)

开源、本地优先的 AI Coding 用量中心。一次扫描即可在浏览器里查看多个 Agent 的
Token、费用估算、活跃时间、模型与项目分布；不登录、不联网也能完整使用本地看板。

当你愿意连接社区时，同一个 Collector 还能把脱敏后的聚合数据同步到
[kimi.builders/usage](https://kimi.builders/usage)，用于跨设备分析、公开档案和排行榜。
本地分析与社区同步是两个独立能力：**打开看板不会自动上传数据。**

## 你能得到什么

- 一个完整的本地 Web 看板：今天、24H、7D、30D、90D 与全部历史。
- 多 Agent 统一口径：输入、缓存写、缓存读、输出、推理、请求和会话。
- 趋势、自然周对比、分时活跃、分布、明细、CSV/JSON 导出与分享海报。
- 模型规范化、推理强度、Agent 版本、终端与操作系统信息（来源可提供时）。
- 按标准 API 价格估算的费用、定价覆盖率与未定价提示；它不是订阅账单。
- 可选的订阅中心：额度历史、消耗节奏、Token 容量与订阅价值观察；以及可选的手动或后台社区同步。

**项目状态：** `0.4.0` 是首个公开 Beta。核心产品、三平台 CI、Provider
contract test、npm provenance 发布流程和本地发布门禁均已建立；仍会把日志格式覆盖有限的
来源明确标为 Beta，而不是把兼容性猜测包装成稳定承诺。
[查看 Roadmap](./docs/ROADMAP.md) · [参与开发](./CONTRIBUTING.md) ·
[反馈问题](./SUPPORT.md) · [0.4.0 发布说明](./docs/RELEASE_NOTES_0.4.0.md) ·
[全部文档](./docs/README.md)

## 实际界面

下面的截图和海报直接由本项目读取本机 Agent 日志后生成，不是设计稿或模拟数据。

### 本地看板

![用量中心总览](./docs/assets/screenshots/dashboard-overview.png)

![每日趋势、自然周趋势与分时活跃](./docs/assets/screenshots/dashboard-trends.png)

### 权益中心

![账户权益、官方额度与本机 Token 容量](./docs/assets/screenshots/dashboard-benefits.png)

### 分享用量

海报只包含适合公开展示的用量洞察，不包含项目、设备、路径或对话内容，也不会放置别人
无法访问的本地二维码。你可以选择自己的头像；图片会自动居中裁成方形并只保存在当前
浏览器，不会上传到社区或第三方服务。

<p align="center">
  <img src="./docs/assets/screenshots/kimi-builders-usage-24h.png" alt="近 24 小时用量海报" width="48%">
  <img src="./docs/assets/screenshots/kimi-builders-usage-30d.png" alt="近 30 天用量海报" width="48%">
</p>

## 开始使用

### npm / npx

需要 [Node.js 20+](https://nodejs.org/)。无需全局安装：

```bash
npx @kimi.builders/usage@latest dashboard
```

它会扫描本机数据，启动仅监听 `127.0.0.1` 的私有看板，并打开一次性授权地址。按
`Ctrl+C` 或关闭运行命令的终端即可停止服务。首次执行 `npx` 时，npm 会下载经过
provenance 签名的公开包；Collector 没有 postinstall，也不会因此扫描或上传数据。

### 从源码运行

需要 [Node.js 20+](https://nodejs.org/)。

```bash
git clone https://github.com/kimi-builders/usage.git
cd usage
npm run setup
npm run dev
```

`npm run setup` 只在第一次运行时安装看板开发依赖。`npm run dev` 会启动本地 API、
Vite 看板并自动打开浏览器，不需要分别运行两个终端。

如果不想自动打开浏览器：

```bash
npm run dev -- --no-open
```

下文统一使用 `npx @kimi.builders/usage …` 写法。在源码目录体验时，将命令前缀替换为
`node ./bin/kbu-usage.js …` 即可。

## 三种能力，三个明确边界

| 能力 | 默认联网 | 是否需要账号 | 数据去向 |
| --- | --- | --- | --- |
| 本地 Token 看板 | 否 | 否 | 仅本机内存与浏览器 |
| 订阅额度 | 否，需逐平台启用 | 供应商本机登录或手动凭据 | 本机直连所选供应商 |
| 社区同步 | 否，需主动连接 | kimi.builders | 脱敏后的聚合数据 |

云端不能主动读取你的电脑。只有运行 `sync`、点击“同步数据”，或明确安装后台服务后，
本机 Collector 才会向社区发送数据。完整网络目标见 [NETWORK.md](./NETWORK.md)。

## 本地看板

```bash
npx @kimi.builders/usage dashboard
```

看板每次启动都会生成新的浏览器访问令牌，并拒绝非本机 Host、Origin 和未授权请求。
“重新扫描”只刷新本机数据；“同步数据”才会执行社区增量同步。

本地价格表按模型、生效时间、上下文档位和处理档位匹配标准 API 单价。看板会明确展示
定价覆盖率、假设定价与未定价 Token，避免把一个不完整的估算伪装成真实账单。

会话时间采用跨工具一致的投入时间口径：

- 活跃时长：同一轮 assistant/tool 事件之间的间隔，每段最多计 5 分钟；
- 投入时长：user 到 assistant/tool 的轮内时间线，每段最多计 30 分钟；
- 长期复用的 session ID 不会把离线数天误算成连续工作时间。

数据字段与计算口径见 [本地快照 v1](./docs/LOCAL_SNAPSHOT_V1.md)。

## 支持的本地用量来源

| Agent | 状态 | 本机来源 |
| --- | --- | --- |
| Kimi Code | 核心 | `~/.kimi-code` 与旧版 `~/.kimi` |
| Claude Code | 稳定 | `$CLAUDE_CONFIG_DIR`、`~/.claude*` 的项目日志 |
| Codex | 稳定 | `$CODEX_HOME` 或 `~/.codex` 的当前与归档会话 |
| OpenCode | 稳定 | SQLite 数据库，旧版 JSON 回退 |
| Gemini CLI | 稳定 | `~/.gemini/tmp` 中的 JSONL/JSON 会话 |
| Antigravity | 稳定 | App 2.0 / `agy` CLI 的离线 SQLite 会话库 |
| GitHub Copilot CLI | 稳定 | 本机 CLI 会话日志 |
| Roo Code | 稳定 | VS Code 扩展的本地任务数据 |
| Pi Coding Agent | Beta | `~/.pi/agent/sessions` 等 JSONL 会话；格式覆盖仍在扩充 |
| ZCode | Beta | 本机 SQLite 会话库；Node 20 可能需要系统 `sqlite3` |
| WorkBuddy / CodeBuddy | Beta | WorkBuddy/CodeBuddy 本机项目会话存储 |
| Cursor | 显式启用 | Cursor Dashboard 主动导出的 Usage CSV |

每个来源独立解析。一个来源损坏、未安装或格式变化，不会阻塞其他来源，也不会清理它
原有的同步 checkpoint。可先运行以下命令检查环境，全程不联网：

```bash
npx @kimi.builders/usage inspect --dry-run
npx @kimi.builders/usage doctor
npx @kimi.builders/usage sources list
```

`doctor --json` 适合附在 Issue 中：它不包含路径、项目、模型、会话 ID 或时间明细，
但仍含汇总数量与脱敏错误，分享前请自行检查。

Cursor 是当前唯一需要显式启用的用量来源：

```bash
npx @kimi.builders/usage sources enable cursor --csv /path/to/usage.csv
npx @kimi.builders/usage sources disable cursor
```

Cursor 的本地来源配置不依赖社区账号或 `init`。启用命令只保存本机 CSV 路径，不会联网，
也不会自动执行社区同步。各来源的成熟度、限制和验证证据见
[来源兼容矩阵](./docs/SOURCE_COMPATIBILITY.md)。

## 订阅额度（可选）

订阅额度与本地 Token 消耗不是同一类数据。它默认关闭；只有你在本地设置里启用某个平台，
Collector 才会复用该平台的本机登录或读取你指定的凭据并发起查询。

当前支持 Codex、Claude Code、Kimi Code、Cursor、GitHub Copilot、Gemini CLI、
Antigravity、OpenCode、Qoder、Warp、JetBrains AI 与 Windsurf。不同平台支持自动检测、
环境变量或 macOS 钥匙串中的一种或多种方式。Trae 暂无稳定且可独立验证的个人额度接口，
因此只显示“暂不可查”，不会生成猜测数据。

额度页默认把 Kimi Code 放在第一位。你可以在设置中抓住手柄直接拖动已启用平台，桌面
鼠标和移动端触控都可用；排序保存在本机，并同时用于额度页签和查询顺序。

每次成功刷新都会在本机保存一份脱敏额度快照。订阅中心会把相同供应商、相同时间窗的
额度变化与本机 Token 对齐，显示消耗速度、重置时预计用量、近 30 天单位 Token 实际成本、
标准 API 等价价值和模型集中度。所有建议都附带证据窗口，仅供续费与工作流决策参考；它
不会自动改套餐，也不会把订阅利用率描述成供应商公布的固定 Token 上限。

额度凭据和响应不会进入 Token 快照、导出文件或社区同步。手动 Secret 不写入普通
`config.json`。脱敏历史最多保留 400 天，较旧数据自动降采样；它同样不会进入导出、海报
或社区同步。各平台网络目标和认证边界见 [NETWORK.md](./NETWORK.md)，本地保存字段见
[PRIVACY.md](./PRIVACY.md)。

## 连接与同步社区（可选）

首次连接：

```bash
npx @kimi.builders/usage init
```

终端会显示设备码并打开社区授权页。授权后，设备得到一枚可单独撤销的 `kbu_` Key。
项目名同步默认关闭；关闭时上传 JSON 中根本不存在 `project` 字段。

单次同步：

```bash
npx @kimi.builders/usage sync
```

持续同步：

```bash
npx @kimi.builders/usage daemon install --interval 15
npx @kimi.builders/usage daemon status
npx @kimi.builders/usage daemon restart
npx @kimi.builders/usage daemon uninstall
```

后台服务以当前用户身份运行，不需要管理员权限：macOS 使用 `launchd`，Linux 使用 user
`systemd`，Windows 使用 Task Scheduler。设备休眠或离线时不会工作；升级 Collector 后
执行一次 `daemon restart`，让服务使用新版本路径。

同步采用增量 checkpoint、失败来源隔离和并发锁。重复运行不会重复计数。如果你在社区
删除了某台设备的数据，并希望重新上传本机仍保留的历史：

```bash
npx @kimi.builders/usage reset --local
npx @kimi.builders/usage sync
```

## 常用命令

| 命令 | 作用 | 网络 |
| --- | --- | --- |
| `dashboard [--no-open] [--port N]` | 启动本地看板 | 默认无 |
| `inspect --dry-run` | 显示读取目录与来源扫描结果 | 无 |
| `doctor [--json]` | 生成脱敏兼容性报告 | 无 |
| `sources list` | 查看本地用量来源状态 | 无 |
| `init [--api-url URL]` | 连接社区设备并首次同步 | 有 |
| `sync` | 上传发生变化的聚合数据 | 有 |
| `daemon install/status/restart/uninstall` | 管理后台同步 | 见 NETWORK |
| `summary [--days N]` | 查看已连接账户的云端摘要 | 有 |
| `status` | 查看本地连接与 checkpoint 状态 | 无 |
| `reset --local` | 清除本地同步 checkpoint | 无 |

本地配置与同步状态位于 `~/.kimi-builders/usage/`；POSIX 系统上的敏感配置文件权限为
`0600`。

## 隐私承诺

Collector **不会上传**：

- prompt、response、reasoning 文本或 tool result；
- 完整路径、文件内容、仓库 remote 或环境变量转储；
- 原始 session ID；
- 供应商 Cookie、OAuth Token、API Key 或额度响应；
- 本地看板的筛选、浏览与操作记录。

Session ID 使用安装级随机盐进行 HMAC-SHA-256 转换，不同设备无法用结果互相对照。
本地快照可以保留项目目录的 basename 供私人分析；社区同步默认移除项目字段。

进一步阅读：

- [开发路线与计划](./docs/ROADMAP.md)
- [参与开发](./CONTRIBUTING.md)
- [问题反馈与排障](./SUPPORT.md)
- [隐私边界](./PRIVACY.md)
- [逐命令网络清单](./NETWORK.md)
- [威胁模型](./THREAT_MODEL.md)
- [安全报告与发布要求](./SECURITY.md)
- [本地版与社区版的产品边界](./docs/PRODUCT_BOUNDARY.md)

## 开发与验证

```bash
npm run setup
npm run dev
```

提交前：

```bash
npm test
npm run dashboard:build
npm run dashboard:test
```

发布前完整检查：

```bash
npm run release:check
```

它会运行 Collector 测试、构建并测试看板，再执行 `npm pack --dry-run` 展示实际发布内容。
`npm publish` 也会通过 `prepublishOnly` 自动执行同一套检查，但不会在检查命令中被调用。
发布流程见 [PUBLISHING.md](./PUBLISHING.md)。

测试会把来源、配置和状态目录指向临时 fixture，不读取开发者真实的 HOME。

如果你准备提交 Parser、额度 Provider、同步协议或 UI 改动，请先阅读
[CONTRIBUTING.md](./CONTRIBUTING.md) 中对应类别的隐私与测试清单。安全漏洞请勿公开建 Issue，
使用 [SUPPORT.md](./SUPPORT.md) 提供的私密报告入口。

## License 与来源说明

本项目整体以 [MIT License](./LICENSE) 开源；项目原创部分 © 2026
`kimi.builders contributors`。

初始 parser 层的部分实现与测试改编自 MIT 许可的
[`@vibe-cafe/vibe-usage`](https://github.com/vibe-cafe/vibe-usage)。产品与额度能力还参考了
Vibe Usage 的桌面客户端；部分 provider 额度协议与解析实现改编自 CodexBar。代码改编、
产品参考与打包依赖被分开记录，不表示相关项目共同拥有、参与维护或为本项目背书。
完整来源见 [NOTICE](./NOTICE)。
