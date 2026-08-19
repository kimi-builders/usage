# 网络行为

> [English](./NETWORK.md)

项目没有遥测、更新检查、广告请求或隐藏的后台连接。本地解析模块不导入网络客户端。只有用户
明确执行 `daemon install` 后才会存在后台同步；它可随时通过 CLI 检查或移除。

| 命令 | 是否联网 | 用途 |
| --- | --- | --- |
| 无参数、`help`、`status`、`sources`、`completion` | 否 | 显示本地帮助、配置、能力与补全脚本 |
| `stats`、`top` | 否 | 本地离线多维用量分析与模型/项目排行 |
| `export` | 否 | 本地导出 Token/Session 用量为 CSV/JSON/JSONL |
| `quota` / `limits` | 仅限已登录/配置平台 | 向明确启用的 Provider 查询公开额度与重置窗口 |
| `inspect --dry-run` | 否 | 显示本地读取目录和解析结果 |
| `doctor [--json]` | 否 | 生成脱敏的本地兼容性报告 |
| `reset --local` | 否 | 删除本地同步 checkpoint |
| `init` | 是 | 只连接设备；除非显式加 `--sync`，否则不上传用量 |
| `sync [--full]` | 是 | 读取隐私设置并上传变化后的聚合；`--full` 只完整重放标记为“本机并同步”的来源 |
| `daemon install/restart` | 是，由调度子进程联网 | 管理用户级系统调度器，并触发首次增量同步 |
| `daemon status/uninstall` | 否 | 检查或移除用户级调度器 |
| 调度执行的 `daemon run` | 是 | 设备在线且唤醒时执行相同的增量同步 |
| `summary` | 默认否（`--remote` 是） | 汇总用量（本地离线计算；`--remote` 读取已连接社区账户云端摘要） |
| `dashboard` | 默认否 | Loopback 本地看板；只有明确操作社区连接/同步或 Provider 额度查询时才联网 |
| `npm run setup` | 是 | 明确从 npm 安装看板开发依赖 |
| `npm run dev` | 默认否 | Loopback Vite + 本地 API；可选额度查询规则与 `dashboard` 相同 |

默认社区地址 `https://kimi.builders` 当前使用以下端点：

- `POST /api/usage/device/code`
- `POST /api/usage/device/token`
- `GET /api/usage/settings`
- `POST /api/usage/ingest`
- `DELETE /api/usage/ingest`
- `GET /api/usage?days=N`

`init --api-url` 可在开发或自托管场景指定其他地址。Collector 只把设备 API Key 发送给配置的
社区 Origin。上传正文是 gzip 压缩 JSON；压缩只改变传输大小，不改变字段。

后台服务使用 macOS `launchd`、Linux user `systemd` 或 Windows Task Scheduler。它只在
`~/.kimi-builders/usage` 下保存调度元数据、最近运行状态、锁和有界本地日志。它没有额外
网络目标，也不会仅因打开看板而安装。

本地 Web 看板只监听 loopback，使用每次启动随机浏览器令牌、严格 Host/Origin 检查、限制性
CSP 和 no-store 响应。Token 分析始终离线。只有用户点击相应控件后，看板才可申请设备授权、
执行一次同步、管理系统调度器、断开当前设备或删除该设备云端历史。订阅额度查询是独立能力，
默认关闭，并且只联系本地设置中明确启用的平台。

额度历史记录、Token 与额度关联、节奏预测和订阅价值观察都是本地计算，不会增加网络目标。
读取看板缓存不会制造重复历史点；只有一次真正的新 Provider 刷新才会追加脱敏观测。

- Codex：`https://chatgpt.com/backend-api/wham/usage`，以及可选的
  `wham/rate-limit-reset-credits` 辅助端点；
- Claude Code：`https://api.anthropic.com/api/oauth/usage`；
- Kimi Code：`https://api.kimi.com/coding/v1/usages`；本机 CLI access token 即将到期时，
  通过 `https://auth.kimi.com/api/oauth/token` 在 Kimi Code 的跨进程锁保护下轮换，
  并原子更新仅 owner 可读的 CLI 凭据文件；当用户明确选择 Web Token 来源时，
  使用 `https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages` 和
  `https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`；
- Cursor：`https://cursor.com/api/usage-summary`，以及可选的
  `https://cursor.com/api/auth/me` 身份端点；
- GitHub Copilot：GitHub 设备授权端点 `https://github.com/login/device/code` 和
  `https://github.com/login/oauth/access_token`，账户身份端点 `https://api.github.com/user`，
  再通过 `https://api.github.com/copilot_internal/user` 读取额度事实；只有用户点击连接后才
  开始设备授权，并支持分别保存多个账户；
- OpenCode Go：先用 `https://opencode.ai/_server` 发现已登录账户的 Workspace，再通过
  `https://opencode.ai/workspace/{id}/go` 获取滚动、每周和每月订阅窗口。每个已保存账户有
  自己由用户提供的 Cookie；`wrk_…` Workspace ID 只是可选覆盖值；
- Qoder：`https://qoder.com/api/v2/me/usages/big_model_credits`；用户选择中国站时使用等价的
  `qoder.com.cn` 端点；
- Warp：`https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo`；
- Antigravity 优先复用已运行的 Antigravity 或 `agy` 进程：只发现该进程监听的回环端口，
  并仅向固定的 `127.0.0.1` 路径发送 `RetrieveUserQuotaSummary`、`GetUserStatus` 或
  `GetCommandModelConfigs` POST。本机自签名 TLS 只在这个固定回环边界内接受；看板不会启动
  或终止用户进程。没有可用本机服务时，用户明确配置的 OAuth 来源才可能访问
  `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`、
  `v1internal:fetchAvailableModels`，必要时还会调用 `v1internal:retrieveUserQuota`；过期 OAuth
  凭据可能通过 `https://oauth2.googleapis.com/token` 刷新；
- DeepSeek：使用用户明确配置的 API Key 请求 `https://api.deepseek.com/user/balance`，只读取
  API 账户按币种返回的总余额、充值余额与赠送余额；不读取浏览器会话，也不访问私有 Platform
  接口；
- JetBrains AI：不联网，只读取最新的本地 IDE 额度文件。

Trae 会显示在配置目录中，但当前版本没有稳定、可独立验证的订阅额度接口，因此保持禁用。
仅在设置中看到某个平台不会触发连接。

这些属于账户产品界面，而不是标准公开 API 用量计量接口。它们是 best-effort 集成，可能独立
于本地日志 Parser 发生变化。任一额度查询失败都会隔离，不会阻塞 Token 看板。
