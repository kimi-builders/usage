# Kimi Builders Usage 0.6.4

> [English](./RELEASE_NOTES_0.6.4.en.md)

## 历史用量与同步

- Kimi Work 桌面会话现在可在本机查看。同一会话在 CLI 和桌面目录都有副本时不会重复累计，已有 CLI 同步授权不会自动扩展到桌面端。要包含桌面端，执行 `kbu-usage sources set kimi-code private --include-desktop`；去掉末尾参数重新执行，即恢复仅同步 CLI。
- Codex 可读取压缩的 `.jsonl.zst` 历史，并合并同一会话的续接片段。用量和耗时样本保留所在片段的项目及版本；快速连续启动的子任务不再漏计。无法解码的归档会标为部分读取，不影响可读会话。
- Claude Code 同一次调用的多个内容块、流式修订以及后来补上请求 ID 的记录只计一次；有独立请求标识的重试仍分别计数。

## 模型与费用估算

- 更新十一月模型价格目录（revision 13）。模型匹配使用路径最后的模型 ID，更改网关或配置名称不会改变同一模型的估算。
- Codex 与 OpenCode 按单次请求的完整输入（包括缓存）区分 GPT‑6.2 长短上下文，不用半小时汇总判断。
- GPT‑6.2 Ultrafast 与 Standard 分开计价，按官方促销期限切换费率。社区协议 v2 暂不支持 Ultrafast 用量桶：保留本机记录，同步时提示跳过，不以标准价代传。API 等价费用是估算，不是订阅账单。

## 升级

```bash
npx @kimi.builders/usage@latest dashboard
```

已安装后台同步的用户可运行 `npx @kimi.builders/usage@latest daemon restart` 更新调度器所用的版本。无需清除本机历史、重连社区或执行完整同步。
