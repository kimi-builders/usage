# 网络行为

> [English](./NETWORK.md)

项目没有遥测、软件版本更新检查、广告请求或隐藏的后台连接。本地解析模块不导入网络客户端。价格目录仅在
`init` 的一次 best-effort 检查、用户运行 `pricing update`，或点击看板“检查更新”时下载；不会上传本机用量。只有用户
明确执行 `daemon install` 后才会存在后台同步；它可随时通过 CLI 检查或移除。

| 命令 | 是否联网 | 用途 |
| --- | --- | --- |
| 无参数、`help`、`sources`、`completion` | 否 | 显示本地帮助、配置、能力与补全脚本 |
| `status` | 仅在已连接时 | 本地配置与绑定社区账户核验（5 秒超时，不上传用量） |
| `stats`、`top` | 否 | 本地离线多维用量分析与模型/项目排行 |
| `export` | 否 | 本地导出 Token/Session 用量为 CSV/JSON/JSONL |
| `quota` / `limits` | 仅限已登录/配置平台 | 向明确启用的 Provider 查询公开额度与重置窗口 |
| `inspect --dry-run` | 否 | 显示本地读取目录和解析结果 |
| `doctor [--json]` | 否 | 生成脱敏的本地兼容性报告 |
| `reset --local` | 否 | 删除本地同步 checkpoint |
| `pricing status/reset` | 否 | 查看目录状态，或删除下载缓存并恢复随包内置离线目录 |
| `pricing update` | 是 | 主动下载、校验并缓存社区公开价格目录；不上传用量 |
| `init` | 是 | 连接设备并 best-effort 更新公开价格目录；除非显式加 `--sync`，否则不上传用量；`--skip-pricing-update` 可跳过价格下载 |
| `sync [--full]` | 是 | 读取隐私设置并上传变化后的聚合；`--full` 只完整重放标记为“本机并同步”的来源 |
| `daemon install/restart` | 是，由调度子进程联网 | 管理用户级系统调度器，并触发首次增量同步 |
| `daemon status/uninstall` | 否 | 检查或移除用户级调度器 |
| 调度执行的 `daemon run` | 是 | 设备在线且唤醒时执行相同的增量同步 |
| `summary` | 默认否（`--remote` 是） | 汇总用量（本地离线计算；`--remote` 读取已连接社区账户云端摘要） |
| `dashboard` | 默认否 | Loopback 本地看板；只有明确操作社区连接/同步或 Provider 额度查询时才联网 |
| `npm run setup` | 是 | 明确从 npm 安装看板开发依赖 |
| `npm run dev` | 默认否 | Loopback Vite + 本地 API；可选额度查询规则与 `dashboard` 相同 |
| `npm run check:pricing-drift` | 是 | 仅供维护者将少量明确映射的供应商/模型与 AI Pricing Guru 比对；不读取本机用量，也不写入价格目录 |

默认社区地址 `https://kimi.builders` 当前使用以下端点：

- `POST /api/usage/device/code`
- `POST /api/usage/device/token`
- `GET /api/usage/device/current`（设备凭据所归属账户的显示身份，不含邮箱）
- `DELETE /api/usage/device/current`（用户明确断开设备）
- `GET /api/usage/settings`
- `POST /api/usage/ingest`
- `DELETE /api/usage/ingest`
- `GET /api/usage?days=N`
- `GET /api/public/usage-pricing/v1/catalog`（公开价格目录；无设备 Key；支持 ETag）

价格目录是公开、版本化 JSON，只包含模型匹配规则、标准 API 美元单价、生效窗口与来源；缓存于
`~/.kimi-builders/usage/pricing-catalog-v1.json`。下载失败、校验失败或离线时保留上次可用版本，
没有缓存时回退 npm 包内置快照，扫描和看板启动不会因此失败。

独立的维护者 CI 价格变化检查仅在定时或手动触发的工作流中读取
`https://www.aipricing.guru/api/pricing.json`。它只比较五个明确映射的模型/供应商身份，
不保存响应产物，只能以失败状态提示人工复核；不会在发布后的 CLI 中运行、不会改写价格目录，
也不会发送本机用量。任何变化都必须由维护者回到目录中已有的供应商官方链接核实。

`init --api-url` 可在开发或自托管场景指定其他地址。Collector 只把设备 API Key 发送给配置的
社区 Origin。上传正文是 gzip 压缩 JSON；压缩只改变传输大小，不改变字段。

后台服务使用 macOS `launchd`、Linux user `systemd` 或 Windows Task Scheduler。它在
`~/.kimi-builders/usage` 下保存调度元数据、最近运行状态、锁、有界本地日志，以及 `runtime/`
中的固定版本 Collector 副本。不依赖 npx 缓存，也不自动下载升级；明确执行 `daemon restart`
才从当前正在运行的版本更新副本。Node 本身仍需保持安装；卸载服务保留副本和用户数据。它没有额外
网络目标，也不会仅因打开看板而安装。

本地 Web 看板只监听 loopback，使用每次启动随机浏览器令牌、严格 Host/Origin 检查、限制性
CSP 和 no-store 响应。Token 分析始终离线。只有用户点击相应控件后，看板才可申请设备授权、
执行一次同步、管理系统调度器、断开当前设备或删除该设备云端历史。订阅额度查询是独立能力，
默认关闭，并且只联系本地设置中明确启用的平台。打开社区同步弹窗时会核验一次绑定账户；
旧社区 API 或离线时明确显示“暂无法确认”，不会猜测账户。本机 Token 页面不发起身份查询。

额度历史记录、Token 与额度关联、节奏预测和订阅价值观察都是本地计算，不会增加网络目标。
读取看板缓存不会制造重复历史点；只有一次真正的新 Provider 刷新才会追加脱敏观测。

- Codex：`https://chatgpt.com/backend-api/wham/usage`，以及可选的
  `wham/rate-limit-reset-credits` 辅助端点；
- Claude Code：`https://api.anthropic.com/api/oauth/usage`；
- Kimi Code：`https://api.kimi.com/coding/v1/usages`；本机 CLI access token 即将到期时，
  通过 `https://auth.kimi.com/api/oauth/token` 在 Kimi Code 的跨进程锁保护下轮换，
  并原子更新仅 owner 可读的 CLI 凭据文件；当用户明确选择 Web Token 来源时，
  使用 `https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages` 和
  `https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`，
  并以可选的
  `https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription`
  补充官方订阅名称；任一可选补充接口失败都不会遮蔽已取得的额度；
- Cursor：`https://cursor.com/api/usage-summary`，以及可选的
  `https://cursor.com/api/auth/me` 身份端点；
- GitHub Copilot：GitHub 设备授权端点 `https://github.com/login/device/code` 和
  `https://github.com/login/oauth/access_token`，账户身份端点 `https://api.github.com/user`，
  再通过 `https://api.github.com/copilot_internal/user` 读取额度事实；只有用户点击连接后才
  开始设备授权，并支持分别保存多个账户；
- OpenCode Go：每个账户独立选择一种连接方式。API Key 方式请求
  `https://opencode.ai/zen/go/v1/usage`；网页登录方式使用该账户自己的 Cookie 请求
  `https://opencode.ai/workspace/{id}/go`。网页登录方式的 Cookie 与 `wrk_…` Workspace ID
  必须来自同一账户，不会跨账户共享；
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
- Kiro：只读打开 Kiro CLI 的本地 `data.sqlite3`，读取其 access token 与 profile ARN，再请求
  `https://codewhisperer.us-east-1.amazonaws.com/` 的
  `AmazonCodeWhispererService.GetUsageLimits`。工具不执行 Kiro CLI、不接管令牌续期；登录过期时
  由用户运行 `kiro-cli login`。奖励 Credits 无法和套餐可靠拆分时不会猜测套餐余额；
- GLM / Z.ai：按所选地区，使用个人 Coding Plan Key 请求
  `https://open.bigmodel.cn/api/monitor/usage/quota/limit` 或
  `https://api.z.ai/api/monitor/usage/quota/limit`；不添加组织请求头、不查询团队或附加分析接口；
- MiniMax：按所选地区请求 `https://api.minimaxi.com/v1/token_plan/remains` 或
  `https://api.minimax.io/v1/token_plan/remains`。仅在 404 或认证失败时回退同一域名的
  `/v1/api/openplatform/coding_plan/remains`；凭据不跟随重定向；
- 百炼 Coding Plan：用户明确提供的控制台 Cookie 仅发送给所选地区的
  `https://bailian.console.aliyun.com` 或 `https://modelstudio.console.alibabacloud.com`
  控制台页面，必要时查询 `/tool/user/info.json` 获取控制台 SEC Token；随后向
  `https://bailian-cs.console.aliyun.com/data/api.json`（中国）或
  `https://bailian-singapore-cs.alibabacloud.com/data/api.json`（国际）发送只读的
  `queryCodingPlanInstanceInfoV2` POST。不自动提取浏览器 Cookie、不接受任意端点替换，
  不购买套餐，也不请求新版 Token Plan 接口；
- JetBrains AI：不联网，只读取最新的本地 IDE 额度文件。

这三个地区型 Coding Plan 的钥匙串凭据、用户填写的价格按地区独立保存；不跨地区重试。
额度历史使用凭据与地区的单向指纹隔离；更换 Key/Cookie 会开始新的历史序列。
凭据、原始额度响应和额度历史均不会上传社区。

Trae 会显示在配置目录中，但当前版本没有稳定、可独立验证的订阅额度接口，因此保持禁用。
仅在设置中看到某个平台不会触发连接。

这些属于账户产品界面，而不是标准公开 API 用量计量接口。它们是 best-effort 集成，可能独立
于本地日志 Parser 发生变化。任一额度查询失败都会隔离，不会阻塞 Token 看板。
