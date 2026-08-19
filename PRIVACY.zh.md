# 隐私说明

> [English](./PRIVACY.md)

`@kimi.builders/usage` 采用本地优先设计。读取和分析本机 Agent 日志不需要 Kimi Builders
账户，也不需要网络。

## 数据边界

| 边界 | 其中存在的数据 | 默认行为 |
| --- | --- | --- |
| 本地来源日志 | Provider 自己保存的对话和用量文件 | 只读 |
| 本地快照 | 聚合 Token bucket、会话时间、本地项目 basename | 只存在于内存 |
| 本地来源策略 | 每个 Agent 的关闭 / 仅本机 / 本机并同步选择 | Owner-only 配置文件 |
| 同步 payload | 协议 v2 聚合和诊断用客户端元数据 | 显式 `sync`，或用户明确安装的后台调度 |
| 公开社区 | 由账户所有者选择公开的周期聚合 | 关闭 |
| Provider 额度/余额查询 | 已启用平台的账户限制、重置元数据或货币余额事实 | 关闭 |
| 本地额度历史 | 脱敏额度百分比和重置窗口 | 只在已启用平台刷新后记录 |

本地快照只包含用户保留为“仅本机”或“本机并同步”的来源。关闭的来源不会解析。项目
basename 对私人分析有价值，因此可存在于本地快照；除非用户在社区设置中启用项目上传，
它会在同步 payload 中被移除。

## 永不上传

- prompt、response、reasoning 文本或 tool result；
- 完整文件路径、仓库 remote 或文件内容；
- 原始 session ID；
- Provider 凭据、Cookie、API Key 或环境变量 dump；
- 本地看板查询和导航行为。

只有用户启用订阅额度查询时，Provider access token 才会在 loopback 看板服务进程内部使用。
自动检测的 token 从 Provider 自己的本机登录存储读取。手动 secret 在可用时使用 macOS
Keychain；普通 Collector 配置只保存 Provider 开关、认证方式、环境变量名、可选 IDE 路径
和 Qoder 站点选择。

OpenCode Go 为每个账户单独保存 Cookie；Workspace 在查询时自动发现，除非用户为该账户
保存可选的 `wrk_…` 覆盖值。原始 token、Cookie 和复制的 cURL 片段永远不会返回浏览器、
进入导出或社区同步。本地账户检测只读取判断支持应用是否登录所需的最少凭据或额度存储字段，
不会读取对话内容。

DeepSeek 属于“仅余额”集成：浏览器只得到规范化的币种、总余额、充值余额、赠送余额和 API
可用状态，得不到 API Key 或原始响应。这些当前货币事实不会换算成 Token 额度，也不会写入
额度历史。本机 DeepSeek 模型用量是另一条按模型家族汇总的本地证据，不能证明某次请求使用了
当前配置的 API Key 账户。

成功刷新订阅额度后，会在 `~/.kimi-builders/usage/subscription-history.json`（或自定义
Collector 目录）保存独立本地历史。它只包含观测时间、Provider ID/label/plan、额度窗口
ID/label、已用/剩余百分比、重置时间、窗口时长和 Provider 返回的数值限制/单位字段；明确
排除账户身份、凭据/来源路径、错误、原始 Provider 响应和本机 Token 记录。支持时文件使用
owner-only 权限。观测最多保留 400 天，并随时间依次压缩为 15 分钟、小时和日粒度。删除该
文件只重置额度历史，不会撤销 Provider 登录或删除 Agent 用量日志。

Session ID 使用 HMAC-SHA-256 和安装级随机 salt 转换。不同安装无法关联转换后的 hash。

## `sync` 上传什么

完整传输契约见 [`docs/LOCAL_SNAPSHOT_V1.md`](docs/LOCAL_SNAPSHOT_V1.md)。主要字段是
来源、Agent 记录的模型事实、UTC 30 分钟时间、互斥 Token 计数、请求数、测量质量、盐化
session hash、会话时间/消息计数，以及用于诊断的客户端和 Agent 版本。

只有 `init`、`sync`、明确二次确认的 `sync --full`、调度执行的 `daemon run`、`summary`
和 loopback 看板中的明确社区操作会联系配置的 Kimi Builders 地址。`init` 只连接设备，除非
同时使用 `--sync`，否则不会上传。安装、检查、重启和移除调度器本身属于本机操作；安装或
重启可能立即触发首次运行。只有用户启用对应集成后，本地看板才会单独联系 Provider 查询
订阅额度。端点清单见 [`NETWORK.zh.md`](NETWORK.zh.md)。

额度历史及由它派生的 Token 关联与决策计算始终留在本机，不进入 CSV/JSON 用量导出、分享
海报或社区同步。

## 公开可见性

同步数据不等于公开数据。社区排行榜和个人主页可见性是独立且默认关闭的账户设置。公开界面
只使用周期聚合，不得暴露项目、设备、session 或小时明细维度。

每个 Agent 的来源策略属于当前设备。把“本机并同步”改为“仅本机”或“关闭”只会停止该来源
未来上传，不会静默删除已有云端历史。看板另有带确认的操作，可删除当前设备的全部云端用量；
账户级公开可见性仍在社区账户内管理。

同步 checkpoint 与配置的社区目标和设备凭据的不可逆指纹绑定。无法证明目标一致时，普通
增量同步会停止。完整重放需要显式 `sync --full`，或在看板中进行第二次确认，并且仍只包含
标记为“本机并同步”的来源。

## 本地报告

`doctor --json` 用于问题反馈：它会排除根目录、路径、项目、模型名、session hash 和 bucket
时间戳。报告仍包含聚合计数和脱敏 Parser 错误，分享前请自行检查。与之不同，`inspect` 会
有意打印正在读取的本地目录，未经认真检查不应分享。
