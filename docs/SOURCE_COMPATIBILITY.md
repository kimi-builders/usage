# 本地用量来源兼容矩阵

> 最后核对：2026-08-13 · Collector `0.4.0`

这份矩阵描述“当前解析器有多少兼容性证据”，不是 Agent 官方支持声明。所有来源都只读
本机日志；一个来源失败不会阻塞其他来源。`doctor --json` 可生成不含路径、项目名、模型名、
会话 ID 和逐条时间的脱敏报告。

## 成熟度定义

| 级别 | 含义 |
| --- | --- |
| Core | 项目的首要来源，当前格式、遗留格式、异常输入和聚合口径有较完整回归测试 |
| Stable | 有冻结 fixture、异常边界和真实样本验证；上游未承诺日志 schema，仍可能随版本漂移 |
| Beta | 已能扫描并有专项测试，但版本、平台或历史格式证据仍有限 |
| Explicit opt-in | 不自动读取；用户必须显式提供导入文件或配置 |

## 0.4.0 矩阵

| 来源 | 级别 | 自动发现 | 主要验证证据 | 已知边界 |
| --- | --- | --- | --- | --- |
| Kimi Code | Core | 是 | 当前/旧版存储、delta、cache、sub-agent、秒级时间戳、损坏记录 | 上游新字段只在能够证实时加入 |
| Claude Code | Stable | 是 | project/transcript、cache TTL、重复 UUID、sidechain、损坏 JSONL | Claude Desktop/Cowork 路径属于兼容读取，格式仍由上游控制 |
| Codex | Stable | 是 | 当前/归档会话、重放去重、推理强度、上下文/处理档位、sub-agent | 无 usage 的事件不会猜测 Token |
| OpenCode | Stable | 是 | SQLite、旧版 JSON、Token 映射与异常记录 | SQLite schema 漂移会按来源失败隔离 |
| Gemini CLI | Stable | 是 | JSONL、旧 JSON、嵌套 sub-agent、损坏记录 | 只读取已有 usage metadata，不从正文推算 |
| Antigravity | Stable | 是 | App/CLI 离线数据库、模型与 Token 映射 | 数据库被锁或格式改变时可能部分读取 |
| GitHub Copilot CLI | Stable | 是 | 会话发现、互斥 cache/input 分类 | 部分版本只保留会话而没有可用 Token |
| Roo Code | Stable | 是 | VS Code task history、cache 字段、时间事件 | 仅覆盖本机仍保留的任务数据 |
| Pi Coding Agent | Beta | 是 | JSONL 会话、Token 分类、空/损坏记录 | 版本矩阵与跨目录复制去重证据仍在扩充 |
| ZCode | Beta | 是 | SQLite 正常/空/损坏数据、项目与供应方映射 | Node 20 无 `node:sqlite` 时依赖系统 `sqlite3`；Windows 真实样本有限 |
| WorkBuddy / CodeBuddy | Beta | 是 | JSONL 项目存储、路由模型、互斥 Token、会话去重 | 产品版本与历史格式样本仍有限；UI 使用 CodeBuddy 品牌图标 |
| Cursor | Explicit opt-in | 否 | 官方 Usage CSV 的引用、Token 分类与引号字段 | 只支持用户主动导出的 CSV，不读取编辑器对话或私有数据库 |

## 平台与 Node.js

- 支持 Node.js 20 及以上。
- CI 在 Ubuntu 的 Node 20/22/24，以及 macOS、Windows 的 Node 22/24 上运行 Collector
  和 Provider contract tests。
- 平台 CI 证明代码路径可以运行，不等于每个 Agent 的每个版本都有真实日志样本。
- ZCode 在 Node 20 的 SQLite 回退路径是 Beta；缺少系统 `sqlite3` 时会明确跳过或失败，
  不会伪造零用量。

## 报告新格式或缺失数据

1. 升级到最新 Collector 后运行 `doctor --json`。
2. 运行 `inspect --dry-run` 核对来源是否被发现；此命令包含本机路径，不要直接公开输出。
3. 使用仓库的 Parser compatibility Issue 模板，填写 Agent 版本、操作系统、Node 版本和计数差异。
4. 不上传完整 JSONL/SQLite、prompt、response、Cookie、Token、项目路径或原始 session ID。

新增或升级一个来源时，必须同步更新本矩阵、冻结 fixture、隐私说明和必要的 NOTICE 来源记录。
