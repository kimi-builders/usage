# Kimi Builders Usage 0.4.1

`0.4.1` 是首个公开 Beta 的补丁版本，修复默认隐私设置下可能阻断首次同步的问题，并让
新用户更快理解、安装和启动本地看板。

## 修复

- 修复项目名上传关闭时的 bucket 合并：如果同一 Claude Code wire bucket 的首个本地
  项目没有 5 分钟缓存写字段、后续项目有该字段，Collector 现在会把缺失值安全地视为
  `0`，不再把 `undefined + Token` 误报为“超过 JavaScript 安全整数范围”。
- 新增真实顺序的回归测试，覆盖可选缓存 TTL 分区在隐私合并前后保持正确总量。
- 该修复不改变上传协议、Token 分类、项目隐私默认值或服务端数据结构。

## 上手体验

- README 首屏改为“一句话定位 → 一条启动命令 → 首次运行步骤 → 离线诊断”，避免新用户
  在项目状态、长功能清单和截图之后才能找到启动方式。
- 增加本地用量、订阅额度和社区同步三条清晰路径，并前置账号、隐私、费用口径与平台
  支持的简短答案。
- 中英文 README 新增可直接复制给 Codex、Claude Code、Kimi Code 等本机 Agent 的
  代办提示词：默认模板只启动本地看板；社区模板必须在设备授权时暂停等待用户确认。
- Agent 模板禁止泄露凭据、完整路径、会话标识和本地看板 capability token，也不会擅自
  启用额度查询或安装后台同步。

## 升级

无需全局安装，直接运行最新版：

```bash
npx @kimi.builders/usage@latest dashboard
```

如果 `0.4.0` 的 `init` 已经完成设备授权但首次同步失败，不需要重新授权；升级后执行：

```bash
npx @kimi.builders/usage@latest sync
```

已经安装后台同步的用户应刷新调度器记录的运行路径：

```bash
npx @kimi.builders/usage@latest daemon restart
```

这些命令不会删除本地历史、社区连接或远端数据。完整隐私与网络边界见
[`PRIVACY.md`](../PRIVACY.md) 和 [`NETWORK.md`](../NETWORK.md)。
