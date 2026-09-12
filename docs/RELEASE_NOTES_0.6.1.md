# Kimi Builders Usage 0.6.1

> [English](./RELEASE_NOTES_0.6.1.en.md)

## 本机扫描

- 新增 Qoder、Qoder CN 和 DeepSeek Harness（DSH）三个 Beta 来源；补齐 Antigravity
  独立 IDE 目录，并将数据库读取失败标为异常，而不是成功的空结果。
- Qoder 按会话、角色与消息 ID 跨物理文件去重，包括部分重叠副本。冲突副本保留一条
  完整观测并提示 partial，不相加、不逐字段拼接最大值。缺少消息 ID/UUID 的记录无法
  证明是副本，保持独立。积分不换算 Token，未知路由档位保持未定价。
- Qoder 目录遍历边发现边解析，不保留全目录文件列表；限制深度 16、目录 2048、条目
  50000、JSONL 文件 10000、总读取 256 MiB，单文件仍为 64 MiB。超限明确提示 partial，
  保留已有同步状态，建议缩小数据目录。
- DSH 支持 V0–V3、多帧 Zstd 和继承会话去重。中间损坏、非法记录及末尾残行均保留
  可读事实并标为 partial；不再误报完整成功或清除缺失记录的 checkpoint。
  `measurement: exact` 仅说明已读 Token 来自原始计数，不代表扫描覆盖完整。
  压缩日志需要 Node ≥22.15 的内置 Zstd 或本机 `zstd`，不会自动安装解压工具。

## 同步体验与后台运行

- CLI / Dashboard 增加批次进度、基于已确认批次的预计剩余时间、重试等待和已确认压缩
  数据量；未完成、部分完成和成功分别保留，诊断细节只写入本机私有日志。
- 已连接用户先看到立即同步与后台同步，再查看可展开的来源范围。摘要使用已保存权限，
  未保存的修改会提示并阻止手动同步，避免把草稿误当成已生效权限。
- 社区账户信息通过已授权的只读接口确认；旧社区或离线时提示暂无法确认，不阻塞本机分析。
- 后台同步复制当前固定版本到本机运行目录，不依赖 npx 缓存，不自动下载 `@latest`。
  系统 Node 可执行文件仍须保留；升级后需主动重载后台运行版本。

## 升级与发布顺序

维护者必须先部署社区的三个来源 ID 和 `GET /api/usage/device/current`，再发布 CLI。
新来源保留 Beta；已有明确来源策略的设备不会自动将它们加入同步。

```bash
npx @kimi.builders/usage@latest dashboard
```

已安装后台同步的用户可在 Dashboard 选择“更新到当前版本”，或执行：

```bash
npx @kimi.builders/usage@latest daemon restart
```

升级不删除本机历史、社区连接、Provider 凭据或远端数据。本轮没有数据库迁移。
