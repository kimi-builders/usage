# 项目文档

> [English](./README.en.md)

如果你是第一次接手项目，按下面顺序阅读：

1. [开发路线与计划](./ROADMAP.md)：当前完成度、下一步优先级和验收标准。
2. [本地版与社区版边界](./PRODUCT_BOUNDARY.md)：功能应该放在哪里，以及不可突破的隐私红线。
3. [本地快照 v1](./LOCAL_SNAPSHOT_V1.md)：Token、session、时间、价格和同步数据契约。
4. [来源兼容矩阵](./SOURCE_COMPATIBILITY.md)：各 Agent 的成熟度、验证证据和已知边界。
5. [参与开发](../CONTRIBUTING.md)：环境、目录、各类改动要求、fixture 与 PR 检查。
6. [问题反馈与排障](../SUPPORT.md)：安全地收集诊断并提交 Issue。

信任与发布文档：

- [隐私边界](../PRIVACY.zh.md)
- [网络目标](../NETWORK.zh.md)
- [威胁模型](../THREAT_MODEL.zh.md)
- [安全政策](../SECURITY.zh.md)
- [发布清单](../PUBLISHING.zh.md)
- [0.5.1 发布说明](./RELEASE_NOTES_0.5.1.md)
- [0.5.0 发布说明](./RELEASE_NOTES_0.5.0.md)
- [0.4.1 发布说明](./RELEASE_NOTES_0.4.1.md)
- [0.4.0 发布说明](./RELEASE_NOTES_0.4.0.md)
- [许可证](../LICENSE)与[来源说明](../NOTICE)

## 维护提醒

下面这些改动不能只改代码：

| 改动 | 必须同时更新 |
| --- | --- |
| 新 Agent parser 或读取目录 | README、兼容矩阵/fixture、PRIVACY，必要时 NOTICE |
| 新额度 provider 或网络域名 | NETWORK、PRIVACY、THREAT_MODEL、provider fixture、NOTICE |
| 新上传字段或字段含义 | 本地快照、protocol test、站点契约、隐私文案 |
| Token/时间/费用口径 | 本地快照、计算说明、Collector/站点共享测试 |
| Daemon 行为或平台支持 | README、NETWORK、SUPPORT、三平台 descriptor test |
| 打包依赖、字体或图标 | package lock、NOTICE、npm pack 审计 |
| 发布版本 | 发布说明、PUBLISHING、SBOM、provenance、干净 checkout 与三平台 smoke test |

新增或修改公开文档时，应同步维护同名中文/英文版本；LICENSE 和 NOTICE 保持单一法律/来源文本。

不知道下一步做什么时，回到 [ROADMAP 的“当前结论”](./ROADMAP.md#当前结论)。
