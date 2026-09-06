# Kimi Builders Usage 0.6.0

> [English](./RELEASE_NOTES_0.6.0.en.md)

`0.6.0` 扩展本机数据位置与 Agent 覆盖，加入 Kiro 权益，并加强损坏记录、扫描性能和
数据源健康状态的发布前防线。社区同步范围不会因为升级自动扩大。

## 数据源与额外目录

- 新增 Grok CLI、Trae CLI 与 MiniMax Code 本机用量解析器，按证据保持 Beta 标识。
- Codex、Antigravity、Pi、Grok 和 Trae 支持额外本机数据目录；完整路径只保存在本机，
  浏览器只接收目录名和不透明标识。
- Codex 父目录发现使用目录数与条目数安全预算，误选宽目录时快速失败并提示选择更窄范围。
- Pi 与 Trae 丢弃缺少可信时间戳的记录，不再将其写入 1970 年的 Token 或会话统计。

## 权益与可信度

- 新增 Kiro 月度与超额 Credits 查询，使用 Kiro CLI 的本机登录并保持 Credits 与 Token 分离。
- Kiro 对负数、非数值和不可能的超额关系关闭失败，不把异常供应商响应伪装成零用量。
- 本机未安装或没有数据的 Agent 现在显示为中性“未检测”，不会触发解析健康告警。

## 发布工程

- 标准 API 价格目录更新至 `2026-09-06`，以 OpenAI、Anthropic、Google、xAI 与 DeepSeek
  的一方文档作为价格依据；OpenCode 独有报价只匹配 OpenCode 来源，不再跨 Agent 套用。
  AI Pricing Guru 仅作为维护者 CI 的差异提示源，不会自动改价或进入用户运行时。价格仍是
  标准 API 等价估算，不代表订阅、渠道或 BYOK 的实际账单。
- Dashboard 构建链升级到已修复安全公告的 Vite 与传递依赖版本。
- CI 和发布检查新增生产依赖审计；保留跨平台测试、包内容审计、SBOM 与 provenance。

## 升级

```bash
npx @kimi.builders/usage@latest dashboard
```

已安装后台同步的用户可运行：

```bash
npx @kimi.builders/usage@latest daemon restart
```

升级不会删除本地历史、社区连接、Provider 账号、凭据或远端数据。
