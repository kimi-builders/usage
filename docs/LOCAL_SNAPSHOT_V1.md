# 本地快照 v1：数据与计算契约

> [English](./LOCAL_SNAPSHOT_V1.en.md)

> 状态：已实现并由自动化测试覆盖。最后按项目 `0.5.1` 代码核对。

本地快照是 parser、CLI、本地 Web 看板和社区同步之间的稳定读取边界。实现入口是
`src/local/snapshot.js`；指标汇总在 `src/local/metrics.js`；上传前的第二次验证在
`src/protocol.js`。

这不是一份存盘的对话数据库。每次扫描都从已知的 Agent 本地存储中只读生成快照，结果主要
保存在当前进程内。社区增量同步另用 `state.json` 保存内容 hash；它只回答“这条聚合记录是否
变化”，不保存 prompt、response 或完整历史副本。

## 1. 数据流

```text
Agent 本地日志 / SQLite / 用户主动导出的 CSV
                    │ 只读
                    ▼
             独立 source parser
                    │
                    ├─ 原始使用事件
                    └─ 原始会话事件
                    ▼
       30 分钟 bucket + 脱敏 session/activity
                    │
                    ├─ 本地协议验证 ── 异常记录隔离
                    ▼
              Local Snapshot v1
              │                │
              ▼                ▼
         本地价格与分析       隐私裁剪 + 增量同步
              │                │
              ▼                ▼
         127.0.0.1 看板      kimi.builders API
```

Parser 模块不依赖网络客户端。生成本地快照不会连接社区，也不会查询订阅额度。额度服务有
自己的数据、凭据和网络边界，不属于本地快照。

## 2. 顶层结构

```text
schemaVersion    固定为 1
generatedAt      本次扫描完成时间（ISO 8601）
locality         本地性、网络请求数与 session identity 说明
sources          每个来源的状态、根目录与诊断
summary          全部来源的汇总
sourceSummaries  按来源汇总
diagnostics      解析、接受与拒绝数量
data
  buckets        30 分钟 Token bucket
  sessions       脱敏 session 与稀疏小时 activity
```

本地看板通过 `createDashboardData()` 生成另一份浏览器安全视图。它会移除来源根目录和
session hash，加入价格匹配、设备事实与聚合后的 `activityHours`。因此浏览器数据、原始快照
和社区上传协议是三个不同层级，不应混为一谈。

## 3. Token bucket

每个 bucket 对齐 UTC 30 分钟边界。聚合键包含来源、原始模型、模型供应方、推理强度、
Agent 版本、上下文档位、处理档位、项目 basename 与时间；同一时间里不同请求事实不会被
错误揉成一条。

| 字段 | 是否必需 | 含义 |
| --- | --- | --- |
| `source` | 是 | Agent 来源 ID |
| `model` | 是 | 日志记录的原始模型名，不因规范化而丢失 |
| `modelCanonical` | 否 | 有可靠映射时的规范模型名 |
| `modelProvider` | 否 | 有可靠证据时的模型供应方 |
| `reasoningEffort` | 否 | 请求明确记录的推理强度；不拿当前设置回填历史 |
| `agentVersion` | 否 | 请求日志明确记录的 Agent 版本；不拿当前版本回填历史 |
| `contextTier` | 否 | `short` / `long`，仅能判断上下文档位时存在 |
| `processingTier` | 否 | `standard` / `batch` / `flex` / `priority` |
| `project` | 否 | 本地项目目录 basename；同步默认直接省略 |
| `bucketStart` | 是 | UTC 30 分钟边界 |
| `inputTokens` | 是 | 新鲜输入 Token |
| `cacheWriteInputTokens` | 是 | 缓存写 Token |
| `cacheWrite5mInputTokens` | 否 | 可识别时的 5 分钟缓存写分区 |
| `cacheWrite1hInputTokens` | 否 | 可识别时的 1 小时缓存写分区 |
| `cacheReadInputTokens` | 是 | 缓存读 Token |
| `outputTokens` | 是 | 非推理输出 Token |
| `reasoningOutputTokens` | 是 | 可分离时的推理输出 Token |
| `requestCount` | 是 | bucket 内的请求数 |
| `creditUnits` | 否 | 只提供 credit 计量的来源值 |
| `measurement` | 是 | `exact`、`estimated` 或 `credit` |

### Token 是否重叠

在来源能够提供细分时，五类主 Token 互斥：

```text
总 Token = 输入 + 缓存写 + 缓存读 + 输出 + 推理输出
```

- 已被识别为 cache read 的数量不会再次留在 `inputTokens`。
- 已被识别为 reasoning 的数量不会再次留在 `outputTokens`。
- `cacheWrite5mInputTokens + cacheWrite1hInputTokens` 不得超过总缓存写。
- 来源只有累计数时，parser 使用 delta/reset 规则；不能安全拆分时标为 `estimated`，不伪造精度。
- 未定价不等于 0 美元：Token 仍进入所有数量统计，只在费用覆盖率中标为未定价。

### 模型身份

原始 `model` 是事实，`modelCanonical` 是解释层。规范化只对有证据的别名生效，例如 Kimi
产品名到具体模型家族；含糊的跨供应商名称保持原样。模型价格匹配优先使用规范模型，同时
保留原始值用于排障和未来重算。

## 4. Session 与时间

Session 不包含对话正文。字段包括来源、可选项目/Agent 版本、盐化 ID、首末消息时间、投入
时长、活跃时长、消息数、用户消息数、旧版 24 小时提示直方图，以及新版稀疏小时切片。

原始 session ID 使用安装级随机盐进行 HMAC-SHA-256：

- 同一安装中保持稳定，便于增量更新；
- 不同安装无法横向关联；
- 尚无持久化配置时使用临时盐，并在 `locality.sessionIdentity` 标为 `ephemeral`。

### 两种时间口径

```text
活跃时长 active
  assistant/tool 连续事件之间的可识别工作时间
  每段 idle gap 最多计 5 分钟

投入时长 engaged（协议字段仍名为 durationSeconds）
  user → assistant/tool 的轮内时间线
  每段 idle gap 最多计 30 分钟
```

新版 `activityHours` 以 UTC 自然小时切分，每个切片包含：

- `activeSeconds`
- `engagedSeconds`
- `messageCount`
- `userMessageCount`

跨小时的时间段会按边界拆分；单小时每种时长最多 3,600 秒；小时合计必须与 session 汇总
完全一致。这使 24H、自然日、自然周和星期 × 本地小时热图可以按范围准确裁剪，不再把所有
提示归到 session 首日，也不让长期复用 ID 放大离线时间。

### 已知限制

- 多数来源无法把 session 时间可靠拆给具体模型或推理强度，相关筛选不会伪造时间分摊。
- `userPromptHours` 为旧协议兼容字段；严肃的日期/小时分析应使用 `activityHours`。
- 来源没有角色或时间事件时，Token 可以精确而 session 时长可能缺失。

## 5. 来源状态和失败策略

| 状态 | 含义 | 同步 checkpoint 行为 |
| --- | --- | --- |
| `ok` | 正常解析 | 可提交变化并清理已消失记录 |
| `partial` | 有可用数据，同时存在缺口 | 上传可用记录，保留该来源旧状态 |
| `skipped` | 未发现本地根目录 | 不解析，保留旧状态 |
| `failed` | 发现来源但解析失败 | 隔离错误，保留旧状态 |

每个 parser 必须独立失败。一个来源格式变化不应阻塞其他来源，也不能因为一次临时错误导致
下一次恢复时全量重传。

协议验证会拒绝负数、非安全整数、过大计数、未知来源、错位时间、越界 session、重复小时和
切片合计不一致等记录。拒绝是逐条的，其余合法数据继续进入看板或同步。

## 6. 费用计算不属于原始事实

费用由 `src/local/pricing.js` 在本地看板转换层计算：

```text
估算费用 = Σ(每个 Token 类别 × 该时间点生效的标准 API 单价) ÷ 1,000,000
```

匹配维度包含模型、来源、生效区间、上下文档位和处理档位。Claude cache write 可进一步使用
5 分钟/1 小时 TTL 价格。看板同时输出：

- `pricedTokens`：被明确价格覆盖；
- `assumedTokens`：需要透明默认假设，例如上下文档位缺失；
- `unpricedTokens`：保留数量但不计费用。

这个值是 API 等价估算，不代表用户订阅账单，也不代表供应商实际向用户收费。

## 7. 本地、上传与公开是三层边界

| 数据 | 本地快照 | 社区同步 | 公开社区 |
| --- | --- | --- | --- |
| Token/请求聚合 | 有 | 有 | 只展示允许的聚合 |
| Session 时间/计数 | 有 | 盐化后有 | 不公开细行 |
| 项目 basename | 有 | 默认无，可明确开启 | 不应成为公开维度 |
| 来源根目录 | 诊断层有 | 无协议字段 | 无 |
| 原始 session ID | 无 | 无 | 无 |
| Prompt/response/tool result | 无 | 无 | 无 |
| Provider 额度凭据与响应 | 独立额度服务 | 永不 | 永不 |

同步不等于公开。公开档案、排行榜和作品关联由社区账户设置单独控制。

## 8. 兼容性与版本策略

v1 允许增加不改变既有含义的可选字段。以下变化必须提升 `schemaVersion`：

- 改变五类 Token 是否重叠；
- 改变 session 时间定义；
- 把本地私有字段加入上传边界；
- 改变字段单位、精度或时间基准；
- 让旧消费者对同一字段得到不同含义。

每次 parser 改动都应保留一份最小、脱敏、冻结的 fixture，并至少断言：总量、Token 互斥、
时间、去重、模型身份、损坏记录处理和根目录覆盖。计划中的 Parser 兼容矩阵见
[ROADMAP.md](./ROADMAP.md)。

## 9. 相关实现与验证

- `src/parsers/`：来源解析
- `src/parsers/index.js`：注册表、bucket 聚合与 session 提取
- `src/local/snapshot.js`：快照生成、来源隔离和 doctor 报告
- `src/local/metrics.js`：价格无关汇总
- `src/local/dashboard-data.js`：浏览器安全视图与价格匹配
- `src/protocol.js`：上传协议验证
- `src/state.js`：增量 checkpoint
- `test/*parser*.test.js`、各来源测试与 `test/consistency.test.js`：Parser 兼容性
- `test/local-snapshot.test.js`、`test/protocol.test.js`：契约边界
