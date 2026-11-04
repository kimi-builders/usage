# Kimi Builders Usage 0.6.3

> [English](./RELEASE_NOTES_0.6.3.en.md)

## StepCode 与 Step Plan

- 新增 Beta 级 StepCode 本机会话扫描，分类记录输入、输出、缓存与推理 Token，
  对复制记录去重，并隔离无法验证归属的分支记录。新增来源默认仅在本机分析，不自动加入社区同步。
- 支持官方 `STEP_CODING_AGENT_SESSION_DIR`、Agent 目录和配置命名空间，
  后台服务保留扫描目录设置；显式目录不可读时不回退扫描其他安装。
- 权益中心新增 StepFun 个人 Step Plan 登录的只读额度查询。
  当前登录已清空、损坏或过期时不借用旧账号；Credit 不换算为 Token。

## 数据与账号兼容性

- 更新 Antigravity 的用量元数据、重试去重、输出与推理分类，
  对缺少时间或无法证明重叠的记录保留不完整状态。
- 补齐 Cursor CSV、官方额度窗口、WorkBuddy 付费周期、JetBrains 新版额度日志，
  以及 Antigravity 新版额度分组兼容性；Cursor 用量仍是主动配置的离线 CSV 导入。
- 收紧 OpenCode Go 本机登录的账号边界：当前凭据存储存在时保持其权威性，
  不因登录缺失、过期、歧义或读取失败而借用旧账号。
- 更新十月末版本化模型价格与标识，保留生效日期、上下文条件、促销期限和未定价信息。
  API 等价价值是估算，不是订阅账单或实际节省。

## 同步反馈与发布质量

- 明确提示社区旧数据保护导致的未覆盖用量桶，不再把相关批次全部标记为已送达。
  完整同步不会解除保护，也不会自动重置 checkpoint 或重放历史。
- Vite 升级至 6.4.5；用等价 SVG pattern 压缩点阵纹理，保留原始外观与严格包体积门禁。
- 补充凭据、目录、后台服务和构建产物回归测试，更新中英文网络边界及来源兼容文档。

## 升级

```bash
npx @kimi.builders/usage@latest dashboard
```

已安装后台同步的用户可在看板选择“更新到当前版本”，或执行：

```bash
npx @kimi.builders/usage@latest daemon restart
```

升级保留本机历史、配置与社区连接。Step Plan 查询需用户主动配置；
本机扫描不依赖在线额度查询，也不会自动扩大已有社区同步权限。
