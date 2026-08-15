# 开发路线与计划

> 当前版本：`0.4.1`（公开 Beta 补丁版本）
>
> 路线图表达优先级与验收标准，不承诺发布日期。供应商事实、本机观测、用户申报目标和
> 带前提的派生估计必须继续保持独立。

## 当前结论

产品与工程基础已经达到首个公开 Beta 的发布标准：多 Agent 本地扫描、完整用量中心、
独立订阅中心、可选社区同步、三平台后台服务、三平台 CI、Provider contract test、npm provenance 与发布物
审计均已实现。文档截图、干净 checkout、实际 tarball 安装烟测、一次性首发凭据和
GitHub Release 配置均已确认；首发完成后立即迁移到 npm Trusted Publishing。

## 已完成

### Collector 与用量中心

- [x] 11 个自动本地来源和一个显式 Cursor CSV 来源；来源独立失败。
- [x] 30 分钟 bucket，以及输入、缓存写、缓存读、输出、推理五类互斥 Token。
- [x] 原始/规范模型、供应方、推理强度、Agent 版本、上下文与处理档位。
- [x] 安装级 HMAC session ID、小时 activity slice、5 分钟活跃与 30 分钟投入上限。
- [x] Today / 24H / 7D / 30D / 90D / All、复合筛选、sticky 筛选条和可分享 hash 导航。
- [x] 总览、趋势、自然周、活跃、分布、明细、预算、小时激增、连续天数与里程碑。
- [x] 标准 API 等价估费、版本化定价、覆盖率、未定价提示和有来源的 CNY 展示换算。
- [x] CSV/JSON 导出、本机头像和无 localhost 二维码的分享用量海报。
- [x] 桌面、移动端、深浅主题、中英文与基础键盘/触控可访问性。

### 订阅中心

- [x] 用量中心与订阅中心同级，订阅分析不继承临时用量筛选。
- [x] Codex、Claude Code、Kimi Code、Cursor、GitHub Copilot、Gemini CLI、Antigravity、
  OpenCode、Qoder、Warp、JetBrains AI、Windsurf；Trae 无可靠接口时明确不可查。
- [x] 官方额度窗口、本机同周期 Token、消耗节奏、容量区间、续费预测、价值和集中度分析。
- [x] 用户自填实际价格/币种/账期，免费与促销权益不混入已支付订阅支出。
- [x] 脱敏额度历史、证据钻取、30/90 天/全部范围和 Provider 顺序拖拽。
- [x] Provider endpoint allowlist、凭据隔离、成功/异常 fixture 与 runtime contract test。

### 社区、后台和发布工程

- [x] Device code 授权、可撤销设备 Key、项目名默认关闭、隐私后 wire-key 合并和增量 checkpoint。
- [x] macOS `launchd`、Linux user `systemd`、Windows Task Scheduler。
- [x] Ubuntu Node 20/22/24、macOS Node 22/24、Windows Node 22/24 发布矩阵。
- [x] Markdown 链接、网络声明、fixture 安全、包内容/体积、无 runtime dependency 与无 install script 审计。
- [x] GitHub Release → npm Trusted Publishing、OIDC provenance、CycloneDX SBOM 和 tarball artifact。
- [x] 自定义社区地址仅允许 HTTPS；HTTP 只允许 localhost/loopback。

## 0.4.0 发布清单

- [x] 数据正确性、隐私同步、Cursor 额度、大历史栈安全和 Windows 授权修复。
- [x] Pi、ZCode、WorkBuddy/CodeBuddy 按证据标为 Beta，并建立来源兼容矩阵。
- [x] `package.json` 版本确认为 `0.4.0`，发布说明已建立。
- [x] 用最终界面覆盖 README 截图并确认不含私人项目、账户、路径或凭据。
- [x] 将 README、LICENSE、NOTICE、docs 和截图纳入 release commit。
- [x] 从干净 checkout 运行 `npm run release:check`。
- [x] 审查实际 `.tgz`，从空临时目录安装并验证 `--version`、`doctor` 和本地 dashboard 启动。
- [x] 配置一次性首发凭据，确认 GitHub remote、默认分支和 Release workflow 权限。
- [x] 创建 `v0.4.0` GitHub Release；由 CI 发布，不从开发机运行 `npm publish`。

## 发布后 P0：兼容反馈与快速修复

目标：首个 Beta 的问题能被安全收集、复现和修复。

- 维护 [来源兼容矩阵](./SOURCE_COMPATIBILITY.md) 的 Agent 版本、平台、fixture 与验证日期。
- 为 Pi/ZCode/WorkBuddy 增加历史格式、截断、重复/复制、Windows 与 Node 20 正向样本。
- 跟踪 Provider contract 漂移；认证失败、接口变化、无额度和网络失败必须保持可区分。
- 对解析/Provider 回归发布 patch 版本，不在 patch 中改变上传协议或隐私默认值。
- 记录首次启动、扫描耗时和包安装问题，但不收集遥测或自动上传诊断。

验收：公开问题能用脱敏 fixture 重现；一个来源改版不影响其他来源或看板启动。

## 发布后 P1：大历史与增量性能

目标：多年历史、数万文件和数十万 bucket 仍有可预测体验。

- 建立 10 万/50 万 bucket 的冷扫描、暖扫描、看板转换、导出与海报 benchmark。
- 记录文件数、读取字节、各来源耗时、峰值内存和最终 payload 大小。
- 设计 parser checkpoint/index；正确处理追加、截断、轮转、SQLite 水位与 Codex fork/replay。
- 大导出改为流式或明确大小保护；长明细使用分页/虚拟化。
- 前端主 chunk 做按页面/对话框分包，保持本地首次打开速度。

验收：先建立可重复 baseline；任何优化不能牺牲去重、损坏恢复或重新计算正确性。

## 发布后 P1：订阅决策质量

- 跨越多个完整周期后展示典型 Token 容量区间和单位成本趋势。
- 增加续费日前回顾：本周期事实、剩余额度、标准 API 等价价值和下周期建议。
- 检测重叠订阅，但允许用户声明不可替代用途；免费/促销账户不生成错误退订建议。
- Agent 分析只生成带证据的只读建议；不得自动更改套餐、凭据、Provider 设置或本机工作流。
- 所有建议必须写明 Provider 观测时点、本机 Token 窗口、用户申报价格和推导假设。

## 发布后 P2：本地体验与社区增量

### 本地体验

- [x] 按 Agent 的关闭/仅本机/本机并同步设置、首次浏览器向导和旧配置无损迁移。
- [x] 社区设备授权、单次同步、Daemon 安装/状态/停用、断开和当前设备云端删除的安全 UI。
- 自定义日期范围和保存的筛选视图。
- 在看板内安全查看后台同步日志正文；当前只显示脱敏路径和最近状态。
- 私人快照备份/恢复和可迁移格式。
- 完整无障碍审计：屏幕阅读器、对比度、键盘、触控和减少动画。

### 社区独有价值

- 跨设备连续历史、设备撤销与重传状态。
- Token Usage 与作品构建排行榜，附未验证本地数据说明和反滥用边界。
- Agent/模型/推理强度匿名群体基准与百分位。
- 可撤销的公开档案、成就、作品关联和分享入口。
- Collector 与站点共享冻结 fixture，防止 Token、费用与时间口径漂移。

## 明确不做或不承诺

- 不上传 prompt、response、reasoning 文本、tool result、文件内容或 Provider 凭据。
- 不把本地日志排行榜描述成 Provider 认证账单、生产力证明或可结算工作量。
- 不为不可观察的额度展示猜测余额、“无限”或伪精确 Token 上限。
- 不让社区远程启用扫描目录、额度 Provider、daemon 或新的上传字段。
- 不因为更多 Provider 数量而跳过兼容性证据、隐私审计和失败隔离。
- 在桌面壳具备签名、更新安全模型和独立卸载方案前，不承诺桌面发行版。

贡献要求见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)，排障与安全反馈见
[`SUPPORT.md`](../SUPPORT.md)，产品边界见 [`PRODUCT_BOUNDARY.md`](./PRODUCT_BOUNDARY.md)。
