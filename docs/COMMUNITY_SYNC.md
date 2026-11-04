# kimi.builders 连接与同步指南

[返回项目介绍](../README.md) · [English](./COMMUNITY_SYNC.en.md)

kimi.builders 是独立的 Web 应用。本文面向已决定将本机聚合用量发送到该应用的用户；
本地看板、命令行统计、导出和订阅分析都可以独立使用。

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
执行一次 `daemon restart`，把当前版本复制到本机固定运行目录。清理 npx 缓存不影响副本，
后台不会自动升级；Node 本身仍需保持安装。

同步弹窗会显示已核验的社区账户、上传确认批次、预计剩余时间和重试等待；命令行也有批次反馈。
部分来源失败会保留为“部分完成”及本地诊断日志，不会刷新“最近完全成功”的时间。

同步采用增量 checkpoint、失败来源隔离和并发锁。重复运行不会重复计数。如果你在社区
删除了某台设备的数据、更换了设备连接，或看板提示本机与社区 checkpoint 无法确认一致，
先核对所有 Agent 的 `private` 范围，再显式完整同步：

```bash
npx @kimi.builders/usage sync --full
```

`--full` 只重传标记为 `private` 的标准化聚合数据，不包含 `off` 或 `local` 来源，也不会
删除社区数据。checkpoint 会绑定到社区地址和设备凭据的不可逆指纹；重新授权后不会误把旧
设备的本机记录当作已经上传。看板遇到相同情况时会展示范围说明并要求二次确认。

如果解析器修复后本机统计比旧的社区记录小，社区的防回退保护可能拒绝覆盖较大的旧值。
看板和 CLI 会提示受保护的用量桶；这时本机与社区数据可能不一致。由于社区只返回受保护
的数量，本机会保留该批次的待确认状态，后续同步会重试；已成功的会话不会重复上传。
`--full` 只是重放，不会绕过保护，也不会删除社区数据。请先核对差异，勿为消除提示而
直接删除云端数据；历史修正需要单独的安全对账方案。

`init` 还会尝试下载公开价格目录；可用 `--skip-pricing-update` 跳过。这个下载不包含本机用量。

打开看板和“重新扫描”不会上传。只有运行 `sync`、点击“立即同步”、安装后台同步或使用
`init --sync`，才会发送标为“本机并同步”的来源。供应商凭据、额度响应、脱敏额度历史、
海报头像与本地偏好均不参与同步。

网络目标、上传字段及产品边界见 [网络行为](../NETWORK.zh.md)、
[隐私说明](../PRIVACY.zh.md) 与 [产品边界](./PRODUCT_BOUNDARY.md)。

## 让 Agent 帮你连接

如果你已经决定连接社区并同步，可以改用下面这个提示词。它会在设备授权时停下来让你
确认，不会擅自安装持续同步服务：

```text
阅读并遵循以下文档的当前说明：
- https://github.com/kimi-builders/usage/blob/main/docs/COMMUNITY_SYNC.md
- https://github.com/kimi-builders/usage/blob/main/PRIVACY.zh.md
- https://github.com/kimi-builders/usage/blob/main/NETWORK.zh.md

帮我把 Kimi Builders Usage 连接到 kimi.builders，并执行一次同步。先确认 Node.js 20+，
再运行离线 dry-run。然后用 `npx @kimi.builders/usage@latest status` 检查现有连接。
如果设备尚未连接，运行 `npx @kimi.builders/usage@latest init`，打开设备批准页面后暂停，
让我检查并批准。批准完成后执行一次 `npx @kimi.builders/usage@latest sync`，核对最终状态，
再启动本地看板。不要输出或复制 API Key、Cookie、凭据、完整本机路径、会话标识或对话内容。
除非我另行明确批准，否则不要安装、重启或移除后台 daemon。
```

## 同步命令

| 命令 | 作用 | 网络 |
| --- | --- | --- |
| `sources set <agent> off\|local\|private` | 设置单个 Agent 的扫描与同步范围 | 无 |
| `init [--api-url URL] [--sync] [--skip-pricing-update]` | 连接社区设备并 best-effort 更新公开价格；默认不上传，`--sync` 才立即同步 | 有 |
| `sync [--full]` | 上传变化的聚合数据；`--full` 经确认后完整重传允许同步的来源 | 有 |
| `daemon install/status/restart/uninstall` | 管理后台定时同步服务 | 见 NETWORK |
| `summary [--days N] [--remote]` | 查看用量汇总（默认本地优先，`--remote` 查看云端） | 本地无 / 远端有 |
| `reset --local` | 清除本地同步 checkpoint | 无 |
