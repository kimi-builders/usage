# 安全政策

> [English](./SECURITY.md)

## 支持版本

安全修复应用于最新发布的 minor 版本。在 `0.5.x` 公开 Beta 期间，请先在最新 `0.5.x`
patch 或仓库默认分支上复现问题，再提交报告。

## 报告安全漏洞

不要在公开 Issue 中提供 Agent 日志、API Key、HOME 目录路径、prompt、response 或私人用量
导出。仓库启用 GitHub Private Vulnerability Reporting 时，请通过该渠道向维护者提交最小
复现。

可使用以下脱敏诊断命令；分享前仍需检查其中的聚合计数：

```bash
npx @kimi.builders/usage doctor --json
```

请提供 Collector 版本、操作系统类别、受影响来源、影响和复现步骤。维护者应在七天内确认
收到报告，并在修复可用后协调披露时间。

## 发布要求

公开版本必须由 CI 通过 npm Trusted Publishing/provenance 生成，在所有支持平台上运行完整
测试，生成 SBOM，并且不得包含 postinstall 脚本。桌面发行物还必须经过对应平台签名。
