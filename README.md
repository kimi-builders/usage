# Kimi Builders Usage

[简体中文](./README.md) · [English](./README.en.md)

[![npm version](https://img.shields.io/npm/v/%40kimi.builders%2Fusage)](https://www.npmjs.com/package/@kimi.builders/usage)
[![CI](https://github.com/kimi-builders/usage/actions/workflows/ci.yml/badge.svg)](https://github.com/kimi-builders/usage/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/github/license/kimi-builders/usage)](./LICENSE)

**把散落在不同 AI Coding Agent 里的本地用量，汇总成一张真正可分析的看板。**

Kimi Builders Usage 会读取 Kimi Code、Claude Code、Codex、OpenCode 等工具已经保存在
你电脑上的日志，统一展示 Token、标准 API 费用估算、活跃时间、模型、项目和订阅额度。
本地看板无需账号、默认不联网；社区同步是独立的可选能力。

## 3 分钟开始

需要 [Node.js 20+](https://nodejs.org/)，无需安装桌面应用或全局 npm 包：

```bash
npx @kimi.builders/usage@latest dashboard
```

第一次运行时：

1. npm 会询问是否下载 `@kimi.builders/usage`，输入 `y`；安装过程不会扫描或上传数据。
2. 本机看板先检测可用 Agent，但不会直接解析全部历史；在首次向导中选择每个 Agent 的
   “关闭 / 仅本机 / 本机并同步”范围后才开始扫描。
3. 扫描完成即可查看本机结果。连接社区、选择同步来源和启用后台同步都是向导中的可选步骤；
   不熟悉命令行也能完成。使用完按 `Ctrl+C` 停止。

> **默认只在本机工作。** 打开看板、点击“重新扫描”以及运行 `init` 都不会上传；`init`
> 只连接设备。只有你明确运行 `sync`、点击“立即同步”、安装后台同步，或使用
> `init --sync` 时，才会发送已标记为“本机并同步”的脱敏聚合数据。

如果看板没有识别到某个工具，先运行完全离线的检查：

```bash
npx @kimi.builders/usage@latest inspect --dry-run
```

[查看支持来源](#支持的本地用量来源) ·
[兼容矩阵与已知限制](./docs/SOURCE_COMPATIBILITY.md) ·
[排查问题](./SUPPORT.md)

### 让 Agent 帮你完成

不熟悉终端也没关系。复制下面的提示词发给 Codex、Claude Code、Kimi Code 或其他能操作
本机终端的 Agent，它会检查环境、扫描来源并启动看板：

```text
阅读 https://github.com/kimi-builders/usage/blob/main/README.md，并按照当前文档在
这台电脑上安装和启动 Kimi Builders Usage。

要求：
1. 优先使用已发布的 npm 包和 npx；除非有明确理由，否则不要克隆仓库或全局安装。
2. 先运行 `node --version`。项目要求 Node.js 20+。如果未安装或版本过低，先说明适合
   当前操作系统的最安全安装方式，得到我确认后再安装或升级。
3. 运行 `npx @kimi.builders/usage@latest inspect --dry-run`，简要说明检测到了哪些
   Agent 来源。回复中不要暴露完整本机路径、凭据、会话标识或对话内容。
4. 运行 `npx @kimi.builders/usage@latest dashboard`，保持进程运行并打开已授权的本地
   看板地址。如果无法自动打开，让我从终端直接复制地址；不要把其中的 capability token
   粘贴到聊天中。
5. 这次只使用本地功能。除非我明确要求，否则不要运行 `init`、`sync` 或 `daemon`，
   不要启用额度 Provider、上传数据或修改隐私设置。
6. 如果命令失败，定位真实原因，只做最小且安全的修复后重试；最后简要说明当前运行状态，
   以及如何停止或重新启动。
```

如果你已经决定连接社区并同步，可以改用下面这个提示词。它会在设备授权时停下来让你
确认，不会擅自安装持续同步服务：

```text
阅读并遵循以下文档的当前说明：
- https://github.com/kimi-builders/usage/blob/main/README.md
- https://github.com/kimi-builders/usage/blob/main/PRIVACY.zh.md
- https://github.com/kimi-builders/usage/blob/main/NETWORK.zh.md

帮我把 Kimi Builders Usage 连接到 kimi.builders，并执行一次同步。先确认 Node.js 20+，
再运行离线 dry-run。然后用 `npx @kimi.builders/usage@latest status` 检查现有连接。
如果设备尚未连接，运行 `npx @kimi.builders/usage@latest init`，打开设备批准页面后暂停，
让我检查并批准。批准完成后执行一次 `npx @kimi.builders/usage@latest sync`，核对最终状态，
再启动本地看板。不要输出或复制 API Key、Cookie、凭据、完整本机路径、会话标识或对话内容。
除非我另行明确批准，否则不要安装、重启或移除后台 daemon。
```

![用量中心总览](./docs/assets/screenshots/dashboard-overview.png)

## 先看重点

| 你可能关心的问题 | 答案 |
| --- | --- |
| 会上传对话或代码吗？ | 不会。Token 看板默认纯本地，也不会读取 prompt、response 或文件内容。 |
| 必须注册社区账号吗？ | 不需要。本地看板和本地订阅分析可独立使用。 |
| 支持哪些 Agent？ | 内置 11 个自动扫描来源，Cursor CSV 可显式启用；详见下方兼容表。 |
| 费用是真实账单吗？ | 不是。费用按标准 API 价格估算，并明确显示定价覆盖率和未定价 Token。 |
| 支持哪些系统？ | macOS、Linux、Windows；需要 Node.js 20 或更高版本。 |

## 按你的需求继续

**只想看本地用量：** 到这里已经完成，不需要 `init`。

**想看订阅额度：** 在本地看板进入“权益中心 → 权益设置”，只启用你使用的平台。额度查询
默认关闭，不会因为打开 Token 看板而访问供应商。

**想同步到社区或跨设备查看：** 点击看板中的“同步数据”，完成浏览器设备授权并选择允许
同步的 Agent；单次同步、后台同步、断开和删除当前设备云端数据都可在看板中管理。CLI
等价方式是：

```bash
npx @kimi.builders/usage@latest init
npx @kimi.builders/usage@latest sync
```

社区只接收脱敏后的聚合记录，项目名默认不上传。完整步骤见
[连接与同步社区](#连接与同步社区可选)。

## 三种能力，三个明确边界

| 能力 | 默认联网 | 是否需要账号 | 数据去向 |
| --- | --- | --- | --- |
| 本地 Token 看板 | 否 | 否 | 仅本机内存与浏览器 |
| 订阅额度 | 否，需逐平台启用 | 供应商本机登录或手动凭据 | 本机直连所选供应商 |
| 社区同步 | 否，需主动连接 | kimi.builders | 脱敏后的聚合数据 |

云端不能主动读取你的电脑。完整网络目标和触发条件见 [网络行为](./NETWORK.zh.md)。

## 你能得到什么

- 今天、24H、7D、30D、90D 与全部历史的完整本地 Web 看板。
- 输入、缓存写、缓存读、输出、推理、请求和会话的跨 Agent 统一口径。
- 趋势、自然周对比、分时活跃、分布、明细、CSV/JSON 导出与分享海报。
- 模型规范化、推理强度、Agent 版本、终端与操作系统信息（来源可提供时）。
- 标准 API 费用估算、定价覆盖率和未定价提示，不把估算伪装成订阅账单。
- 可选的订阅中心：额度历史、消耗节奏、Token 容量和订阅价值观察。

## 更多界面

截图和海报均由真实本机 Agent 日志生成，不是设计稿或模拟数据。

![每日趋势、自然周趋势与分时活跃](./docs/assets/screenshots/dashboard-trends.png)

![账户权益、官方额度与本机 Token 容量](./docs/assets/screenshots/dashboard-benefits.png)

分享海报不会包含项目、设备、路径或对话内容，也不会放置外部无法访问的本地二维码。
自定义头像只保存在当前浏览器，不会上传到社区或第三方服务。

<p align="center">
  <img src="./docs/assets/screenshots/kimi-builders-usage-24h.png" alt="近 24 小时用量海报" width="48%">
  <img src="./docs/assets/screenshots/kimi-builders-usage-30d.png" alt="近 30 天用量海报" width="48%">
</p>

**项目状态：** 当前是公开 Beta。稳定来源经过跨平台 fixture 与 contract test；日志格式
覆盖有限的来源会明确标为 Beta。[Roadmap](./docs/ROADMAP.md) ·
[发布说明](./docs/RELEASE_NOTES_0.5.2.md) · [全部文档](./docs/README.md)

## 从源码运行

```bash
git clone https://github.com/kimi-builders/usage.git
cd usage
npm run setup
npm run dev
```

`npm run setup` 只在第一次安装看板开发依赖。`npm run dev` 会同时启动本地 API 和 Vite
看板，不需要两个终端。下文使用 `npx @kimi.builders/usage …`；源码目录中可替换为
`node ./bin/kbu-usage.js …`。

如果不想自动打开浏览器：

```bash
npm run dev -- --no-open
```

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

Cursor 是当前唯一需要先提供数据文件的用量来源。新手可在首次设置或看板的
“本机与数据源”中粘贴 CSV 完整路径并验证；终端用户也可以执行：

```bash
npx @kimi.builders/usage sources enable cursor --csv /path/to/usage.csv
npx @kimi.builders/usage sources disable cursor
```

Cursor 的本地来源配置不依赖社区账号或 `init`。看板验证和启用命令都只保存本机 CSV 路径，不会联网，
也不会自动执行社区同步。各来源的成熟度、限制和验证证据见
[来源兼容矩阵](./docs/SOURCE_COMPATIBILITY.md)。

## 订阅额度（可选）

订阅额度与本地 Token 消耗不是同一类数据。它默认关闭；只有你在本地设置里启用某个平台，
Collector 才会复用该平台的本机登录或读取你指定的凭据并发起查询。

当前支持 Codex、Claude Code、Kimi Code、Cursor、GitHub Copilot、Antigravity、
OpenCode Go、Qoder、Warp 与 JetBrains AI。不同平台支持自动检测、
环境变量或 macOS 钥匙串中的一种或多种方式。Trae 暂无稳定且可独立验证的个人额度接口，
因此只显示“暂不可查”，不会生成猜测数据。

Gemini CLI 的个人版 OAuth 权益入口已由 Google 退役，因此不再作为权益 Provider；已有的
Gemini CLI 本机 Token 历史仍由离线 Parser 保留。Antigravity 会优先复用已经运行并登录的
Antigravity 或 `agy` 回环服务，读取 Gemini 与 Claude/GPT 的 5 小时和每周额度；工具不会为
额度查询自动启动或终止用户进程。没有可用本机服务时，才会使用用户明确配置的 Antigravity
OAuth 或 CodexBar 凭据。

额度页默认把 Kimi Code 放在第一位。你可以在设置中抓住手柄直接拖动已启用平台，桌面
鼠标和移动端触控都可用；排序保存在本机，并同时用于额度页签和查询顺序。

每次成功刷新都会在本机保存一份脱敏额度快照。订阅中心会把相同供应商、相同时间窗的
额度变化与本机 Token 对齐，显示消耗速度、重置时预计用量、近 30 天单位 Token 实际成本、
标准 API 等价价值和模型集中度。所有建议都附带证据窗口，仅供续费与工作流决策参考；它
不会自动改套餐，也不会把订阅利用率描述成供应商公布的固定 Token 上限。

额度凭据和响应不会进入 Token 快照、导出文件或社区同步。手动 Secret 不写入普通
`config.json`。脱敏历史最多保留 400 天，较旧数据自动降采样；它同样不会进入导出、海报
或社区同步。各平台网络目标和认证边界见 [网络行为](./NETWORK.zh.md)，本地保存字段见
[隐私说明](./PRIVACY.zh.md)。

## 连接与同步社区（可选）

首次连接（也可完全在看板“同步数据”中完成）：

```bash
npx @kimi.builders/usage init
```

终端会显示设备码并打开社区授权页。授权后，设备得到一枚可单独撤销的 `kbu_` Key；
`init` 本身不会上传用量，接下来请在看板或 `sources set` 中确认来源范围，再执行同步。
项目名同步默认关闭；关闭时上传 JSON 中根本不存在 `project` 字段。

连接验证码有效 10 分钟，只临时保留在当前 Collector / 本地看板进程中，不会写入浏览器
存储或配置文件。刷新看板可继续当前请求；停止或重启进程后需要生成新验证码。设备 Key
则在批准后仅交付一次，并可随时从本地看板安全撤销。

每个 Agent 都有三个独立模式：

```bash
npx @kimi.builders/usage sources list
npx @kimi.builders/usage sources set codex off
npx @kimi.builders/usage sources set kimi-code local
npx @kimi.builders/usage sources set claude-code private
```

`off` 不扫描，`local` 只进入本机分析，`private` 才允许发送到你的社区账户。改变模式不会
自动删除已有云端历史；删除当前设备云端数据是看板中的独立确认操作。新支持的 Agent 默认
只在本机启用，不会自动加入同步；这些聚合数据是否公开由社区账号设置另行控制。

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
删除了某台设备的数据、更换了设备连接，或看板提示本机与社区 checkpoint 无法确认一致，
先核对所有 Agent 的 `private` 范围，再显式完整同步：

```bash
npx @kimi.builders/usage sync --full
```

`--full` 只重传标记为 `private` 的标准化聚合数据，不包含 `off` 或 `local` 来源，也不会
删除社区数据。checkpoint 会绑定到社区地址和设备凭据的不可逆指纹；重新授权后不会误把旧
设备的本机记录当作已经上传。看板遇到相同情况时会展示范围说明并要求二次确认。

## 常用命令

| 命令 | 作用 | 网络 |
| --- | --- | --- |
| `dashboard [--no-open] [--port N]` | 启动本地看板 | 默认无 |
| `inspect --dry-run` | 显示读取目录与来源扫描结果 | 无 |
| `doctor [--json]` | 生成脱敏兼容性报告 | 无 |
| `sources list` | 查看本地用量来源状态 | 无 |
| `sources set <agent> off\|local\|private` | 设置单个 Agent 的扫描与同步范围 | 无 |
| `init [--api-url URL] [--sync]` | 连接社区设备；默认不上传，`--sync` 明确沿用连接后立即同步 | 有 |
| `sync [--full]` | 上传变化的聚合数据；`--full` 经确认后完整重传允许同步的来源 | 有 |
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
- [隐私边界](./PRIVACY.zh.md)
- [逐命令网络清单](./NETWORK.zh.md)
- [威胁模型](./THREAT_MODEL.zh.md)
- [安全报告与发布要求](./SECURITY.zh.md)
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
发布流程见 [发布清单](./PUBLISHING.zh.md)。

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
