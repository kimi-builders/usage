# 威胁模型

> [English](./THREAT_MODEL.md)

## 资产

- 本机 Agent 日志和项目身份；
- 安装级本地 session salt；
- 每设备 `kbu_` API Key；
- 可选的 Provider 订阅凭据和额度元数据；
- 私人用量聚合和云端账户历史；
- 社区排行榜和工作用量声明的完整性。

## 信任边界

1. Provider 自己的文件是不可信输入，并且只能只读打开。
2. Parser 把它们转换为本地快照 v1 契约。
3. 上传前验证会在网络传输前隔离不合法记录。
4. 云端 API 再次验证协议，并负责公开可见性规则。

## 范围内

- 损坏、超大、截断或正在并发写入的 Agent 日志；
- 意外上传 prompt、路径、凭据或项目身份；
- 单个 Parser 失败时不阻塞或删除其他来源状态；
- 发现 Provider 存储时遇到的符号链接和路径异常；
- 恶意网页尝试访问 loopback 看板端点；
- 额度凭据意外进入浏览器响应、导出、日志或同步；
- API Key 泄露到日志或诊断中；
- 向社区排行榜提交伪造的本地聚合；
- 依赖或发布管线被破坏。

## 已有控制

- 无运行时依赖和安装脚本；
- 项目名上传默认拒绝；
- 加盐的单向 session 标识；
- 按来源隔离失败并保护 checkpoint；
- 本地与服务端双重协议验证；
- 对时间、字符串、计数、批量大小和 activity slice 设边界；
- `doctor --json` 输出符合隐私要求；
- Provider 端点 allowlist、需主动启用的额度查询，以及支持时使用 OS Keychain 保存手动凭据。

## 本地 Web UI 控制

- 只监听 loopback，并由操作系统选择随机高位端口；
- 首个 URL 带每次启动随机 capability token；
- 拒绝非 loopback 对端和异常 Host/Origin；
- 限制性 CSP，不使用远程脚本、字体、图片或 CORS 通配符；
- 没有文件服务路由，也不根据用户输入解析文件路径；
- 响应头禁止缓存私人数据；
- 可正常停止，并明显说明进程只在本机运行；
- 测试覆盖 DNS rebinding、CSRF、跨 Origin 请求和令牌复用；
- POST 设置接口要求 capability cookie、正确 Host/Origin 和 JSON content type，并限制请求体大小；
- 额度请求错误按 Provider 隔离，不会修改本机 Token 事实。

## 排行榜限制

开源发布 provenance 只能证明官方包由哪份源码生成，不能证明本机日志或上传用量真实。社区排行
应当是认可机制，而不是结算依据。涉及奖金、额度或工作量证明时，需要独立的 Provider 计量。

## 范围外

- 已被恶意软件控制，或被同等文件系统权限的其他用户控制的设备；
- 设备所有者自行伪造 Provider 日志；
- Provider 账单的正确性；
- 恢复被 Provider 或用户删除的来源日志。
