# 问题反馈与排障

## 先判断是哪一类问题

| 类型 | 示例 | 建议入口 |
| --- | --- | --- |
| Parser 兼容 | Agent 有数据但扫描为 0、Token 明显缺失 | Parser compatibility Issue |
| 本地看板 | 白屏、图表/移动端/导出问题 | Bug report Issue |
| 订阅额度 | 某 provider 登录检测或额度失败 | Quota provider Issue |
| 社区同步 | `init`、`sync`、checkpoint 或远端结果异常 | Bug report Issue |
| 后台同步 | launchd/systemd/Task Scheduler 未运行 | Bug report Issue |
| 新功能/新来源 | 新 Agent、图表或工作流建议 | Feature request |
| 安全漏洞 | 可泄露日志、凭据、越权访问 | GitHub Private Vulnerability Reporting |

仓库 Issue：<https://github.com/kimi-builders/usage/issues>

## 提交 Issue 前

1. 确认使用当前仓库版本：

   ```bash
   node ./bin/kbu-usage.js --version
   ```

2. 运行不会联网的体检：

   ```bash
   node ./bin/kbu-usage.js doctor
   node ./bin/kbu-usage.js doctor --json
   ```

3. 如果是 Parser 问题，本地查看实际扫描目录：

   ```bash
   node ./bin/kbu-usage.js inspect --dry-run
   ```

   `inspect` 会打印本机路径，**不要直接把完整输出公开粘贴到 Issue**。

4. 如果是后台同步：

   ```bash
   node ./bin/kbu-usage.js daemon status
   ```

5. 重现一次问题，记录命令、预期、实际结果和发生时间。

## Issue 中应该包含

- Collector 版本与 commit（源码运行时）；
- 操作系统名称、版本与架构；
- Node.js 版本；
- 受影响的 Agent/provider 与其版本；
- 最小复现步骤；
- 预期行为和实际行为；
- 是否稳定复现，近期是否升级 Agent；
- 已审查的 `doctor --json` 报告；
- UI 问题的脱敏截图、视口大小、主题和语言。

## 绝对不要公开提交

- Prompt、response、reasoning 文本或 tool result；
- Provider Cookie、OAuth Token、API Key、`kbu_` Key 或复制的 cURL；
- 完整 HOME/项目路径、仓库 remote、私人项目名或客户名；
- 原始 session ID、账户 ID、邮箱或未打码截图；
- `~/.kimi-builders/usage/config.json` 原文件；
- 完整 Agent 数据库、JSONL、SQLite 或对话导出。

如果最小 fixture 必须来自真实数据，请先复制到临时位置，删除正文和身份字段，替换所有 ID、
路径、时间、模型和计数，并在上传前逐行检查。维护者不应要求你在公开 Issue 提交原始日志。

## 常见排障

### 本地看板打不开或显示扫描失败

- 从仓库根目录运行 `npm run setup`，之后使用 `npm run dev`；不要单独执行
  `npm --prefix dashboard run dev`，后者只有 Vite 前端，没有本地数据 API。
- 查看终端打印的完整授权 URL，不要手工删除查询参数。
- 确认没有另一个防火墙/安全工具阻止 `127.0.0.1`。
- 运行 `doctor` 判断是看板服务问题还是某个来源解析问题。

### 一个来源失败

- 其他来源应继续工作；失败来源的旧 checkpoint 会保留。
- 记录 Agent 版本和最近是否升级。
- 使用 `inspect --dry-run` 确认检测到了正确根目录，但公开反馈时隐藏路径。
- 不要为了测试而移动、修改或删除 provider 自己的原始日志。

### 订阅额度不可用

- Token 看板与额度独立；额度失败不影响本地 Token 数据。
- 在额度设置中确认 provider 已启用并检查“检测详情”。
- 区分未配置、登录过期、接口变化和暂不可查。
- 环境变量需要在启动看板之前设置；Keychain 模式可留空保持已有 secret。
- 不要在 Issue 中粘贴 Cookie、Token 或完整响应。

### 社区同步失败

- 运行 `status` 确认设备已连接。
- `sync` 会先读取社区隐私设置；不能获得有效设置时会安全取消。
- 4xx 通常表示授权或请求问题，盲目重试无效；网络/5xx 会有界重试。
- 同步成功的批次才写 checkpoint；失败来源不会阻塞其他来源。
- 如果远端数据已删除且需要重传：

  ```bash
  node ./bin/kbu-usage.js reset --local
  node ./bin/kbu-usage.js sync
  ```

  这会清除本机增量状态并重新上传仍可读取的历史，执行前确认这是你想要的结果。

### 后台同步没有运行

- 运行 `daemon status --json` 查看 scheduler、安装版本、运行时路径和最近错误。
- Collector 升级或源码目录移动后执行 `daemon restart`。
- 日志路径由 `daemon status` 输出；分享日志前检查路径、错误和本机信息。
- `daemon uninstall` 只移除调度器和 metadata，不删除本地历史或远端数据。

### npm cache 权限错误

如果 `npm` 报告 `~/.npm` 包含 root-owned 文件，这是本机 npm cache 权限问题，不是
Collector 数据问题。不要用 `sudo npm` 运行本项目。可先使用独立 cache 验证：

```bash
NPM_CONFIG_CACHE=/tmp/kbu-npm-cache npm run release:check
```

永久修复全局 cache 前请理解 `chown` 的目标范围，避免对 HOME 或仓库执行宽泛递归命令。

## 安全问题

可能泄露凭据、绕过 loopback capability token、跨 Origin 访问本地数据、上传对话/路径，或
影响发布供应链的问题，不要开公开 Issue。使用仓库的 GitHub Private Vulnerability
Reporting：

<https://github.com/kimi-builders/usage/security/advisories/new>

报告中使用虚构凭据和最小复现。支持版本和响应目标见 [SECURITY.md](./SECURITY.md)。
