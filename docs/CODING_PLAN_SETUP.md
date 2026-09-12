# GLM、MiniMax 与百炼套餐连接

[English](./CODING_PLAN_SETUP.en.md)

三个平台都在本地看板的 **权益中心 → 权益设置 → 全部平台** 中，默认关闭。
展开卡片，先选择你购买套餐的中国站或国际站，再启用、配置并保存。
“已检测”只表示找到凭据，不等于查询成功；保存后的额度状态才是查询结果。

| 平台 | 需要的凭据 | 当前展示 |
| --- | --- | --- |
| GLM / Z.ai | 对应地区的个人 Coding Plan API Key | 官方多窗口百分比、重置时间、独立 MCP 额度 |
| MiniMax | Coding / Token Plan 专用 API Key，通常为 `sk-cp-…` | 模型/服务额度、可验证的每周窗口与重置时间 |
| 百炼 Coding Plan | 对应地区控制台的 Cookie | 5 小时、每周、每月的官方请求额度 |

## 如何填写

macOS 可选择“手动配置”并粘贴凭据，保存到系统钥匙串；不会存入浏览器存储或普通配置 JSON。
其他系统使用环境变量：卡片里填的是**变量名**，凭据在启动看板前设置，不要把密钥当变量名填入。

GLM、MiniMax：点击卡片中的官方链接，登录你的个人套餐账户，获取该套餐的 Key。
普通按量付费 API Key 不一定能读取订阅额度；不要用团队 Key 代替个人套餐 Key。

百炼：打开卡片的官方控制台链接 → 浏览器开发者工具 Network → 刷新 Coding Plan 页面 →
找到 `queryCodingPlanInstanceInfoV2` 请求，复制请求头中的 `Cookie`，或复制该请求的 cURL。
只读取其中的 Cookie 字面值，**不会执行 cURL 命令**。普通 DashScope Key 不能替代此 Cookie。
不要把 Cookie 发到 Issue、聊天或社区；过期时重新登录并替换。

默认环境变量名（也可在卡片里自定义）：

| 平台 | 中国站 | 国际站 |
| --- | --- | --- |
| GLM / Z.ai | `GLM_API_KEY` | `Z_AI_API_KEY` |
| MiniMax | `MINIMAX_CODING_API_KEY` | `MINIMAX_CODING_API_KEY_GLOBAL` |
| 百炼 | `ALIBABA_CODING_PLAN_COOKIE` | `ALIBABA_CODING_PLAN_COOKIE_GLOBAL` |

保存后可在看板刷新，或执行 `kbu-usage quota --provider glm`、
`kbu-usage quota --provider minimax`、`kbu-usage quota --provider alibaba-coding`。

## 数据边界与排查

- 每个平台当前选一个地区查询；两地区的钥匙串凭据、权益分类、价格和续期日分别保留。
  切换会清空尚未保存的凭据输入；自定义环境变量由你负责对应正确地区。
- Key/Cookie 更换后开始新的额度历史序列，不把旧账户的历史接到新账户上。
- 不会跨地区尝试凭据。报登录过期时先核对地区、套餐 Key 类型，再更新凭据。
- GLM 的 `TOKENS_LIMIT` 不是可用原始 Token 总数；MCP 单独展示。
  MiniMax 的 `usage_count` 表示剩余量；百分比接口中的零计数占位符不代表没用过。
- 未返回额度不等于免费、无限或没有使用；未知窗口不生成假进度条。
- 无法证明本机请求属于哪份套餐，因此这三个平台暂不自动关联本机 Token、估算容量或给出低价值结论。
  你的本地用量中心仍正常统计所有已支持 Agent。
- 暂不支持 GLM 团队范围、百炼新版个人/团队 Token Plan、多账户同时查询，也不读 MiniMax 账单历史。
  接口为 best-effort；协议变化会显示错误，不猜数据。凭据仅发给[网络说明](../NETWORK.zh.md)列出的官方域名。
