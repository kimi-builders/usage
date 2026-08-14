# Kimi Builders Usage 0.4.0

`0.4.0` 是第一个公开 Beta 候选：一个开源、本地优先的多 Agent 用量与订阅分析工具。

## 主要能力

- 在 loopback-only Web 看板统一分析 11 个自动来源和一个显式 Cursor CSV 来源。
- 展示 Today、24H、7D、30D、90D 与全部历史的 Token、标准 API 等价费用、活跃时间、
  趋势、自然周、热图、分布、明细、预算、激增和里程碑。
- Token 分类保持输入、缓存写、缓存读、输出和推理互斥；保留模型、推理强度、Agent 版本、
  上下文与处理档位等可证实事实。
- 提供本机 CSV/JSON 导出和无 localhost 二维码的分享用量海报。
- 独立订阅中心覆盖 12 类 Provider，保存脱敏额度历史，并把供应商额度事实、本机 Token 和
  带前提的容量/价值估计严格分开。
- 可选连接 kimi.builders，支持单次同步以及 macOS `launchd`、Linux user `systemd`、
  Windows Task Scheduler 后台同步。

## 隐私与安全

- 本地看板无需账号，默认不联网；打开页面不会自动上传。
- 不读取或上传 prompt、response、reasoning 文本、tool result、完整路径或文件内容。
- Session ID 使用安装级随机盐 HMAC；项目名上传默认关闭。
- Provider 凭据与额度原始响应不进入浏览器、导出、海报或社区同步。
- 本地 HTTP 服务仅监听 loopback，使用每次启动随机 capability token，并校验 Host、Origin
  和写请求类型。
- Collector 包没有运行时依赖和 install/postinstall 脚本。

## 0.4.0 发布质量

- GitHub Actions 覆盖 Ubuntu Node 20/22/24、macOS Node 22/24 和 Windows Node 22/24。
- Provider 使用脱敏成功/异常 fixture 运行 contract test，不在 CI 请求真实账户。
- 发布由 GitHub Release 触发；首发使用一次性短期凭据建立包，随后切换到 npm Trusted
  Publishing。工作流生成 provenance、SBOM 和受审 tarball。
- 发布门禁包含 Collector 测试、Dashboard 构建与测试、Markdown 链接检查和 `npm pack` 审计。

## 已知边界

- Pi Coding Agent、ZCode、WorkBuddy/CodeBuddy 为 Beta 来源；详见
  [来源兼容矩阵](./SOURCE_COMPATIBILITY.md)。
- Cursor 用量需要用户从 Cursor Dashboard 导出 CSV 后显式启用。
- 标准 API 费用是带覆盖率的等价估算，不是订阅账单；CNY 仅为带版本来源的展示换算。
- 订阅 Provider 使用上游未公开或半公开接口时属于 best effort；失败不会影响 Token 看板。
- 首次扫描和超大历史仍有性能优化空间，当前不会安装全局索引或修改原始 Agent 日志。
- 社区排行榜只能代表用户提交的本地聚合，不能作为 Provider 认证账单或工作量证明。

## 升级与后台服务

直接使用最新版本：

```bash
npx @kimi.builders/usage@latest dashboard
```

已经安装后台同步的用户升级后应刷新调度器记录的运行路径：

```bash
npx @kimi.builders/usage@latest daemon restart
```

该命令不会删除本地历史、社区连接或远端数据。完整命令、隐私与网络边界见项目 README、
[`PRIVACY.md`](../PRIVACY.md) 和 [`NETWORK.md`](../NETWORK.md)。
