# 参与开发

感谢你帮助改进 Kimi Builders Usage。这个项目会接触开发者本机日志和账户额度，正确性、
隐私和可解释性优先于“支持数量”或开发速度。

## 开始之前

1. 阅读 [README](./README.md)、[产品边界](./docs/PRODUCT_BOUNDARY.md)和
   [本地快照契约](./docs/LOCAL_SNAPSHOT_V1.md)。
2. 从 [Roadmap](./docs/ROADMAP.md) 的 P0/P1、小型文档问题或已有 Issue 选择任务。
3. 较大的协议、新来源、新网络目标或产品边界变化，先开 Issue 说明方案，避免实现完成后才
   发现方向不合适。
4. 不要把真实对话、凭据、完整路径或未经脱敏的用户数据提交到仓库。

## 本地环境

需要 Node.js 20+。

```bash
git clone https://github.com/kimi-builders/usage.git
cd usage
npm run setup
npm run dev
```

不自动打开浏览器：

```bash
npm run dev -- --no-open
```

核心测试：

```bash
npm test
npm run dashboard:build
npm run dashboard:test
```

完整发布预检：

```bash
npm run release:check
```

测试应通过环境变量、临时目录和 fixture 隔离，不得读取开发者真实 HOME。需要手工查看真实
本机数据时，不要把输出或截图直接放进 Issue/PR。

## 仓库结构

```text
bin/                       CLI 入口
src/parsers/               各 Agent 本地日志解析
src/local/                 本地快照、指标、价格与 loopback 服务
src/limits/                订阅额度 catalog、凭据和 provider 适配
src/sync*.js / api.js      社区协议、增量同步与运行状态
src/daemon.js              launchd / systemd / Task Scheduler
dashboard/src/             React 本地看板与海报
test/                      Collector、协议、安全和平台测试
dashboard/tests/           看板分析与打包测试
docs/                      数据契约、产品边界和路线图
```

## 不同类型改动的要求

### Parser 或新 Agent 来源

- 只读取固定、可说明的目录；`roots()` 必须支持测试覆盖且不得在 override 失败后回退真实 HOME。
- 添加最小脱敏 fixture，不提交完整真实 session。
- 覆盖 current/legacy、空数据、损坏行、去重、时间、Token 互斥和来源失败。
- 保留原始模型名；只有证据充分时写 `modelCanonical`、供应方、推理强度或版本。
- 不以当前 CLI 设置或版本回填历史请求事实。
- 更新 README 来源表、未来 Parser 兼容矩阵、PRIVACY/NETWORK（如适用）和 NOTICE（如有参考代码）。

### 订阅额度 provider

- 先说明接口是否公开、凭据从哪里来、允许访问哪些域名以及为什么需要。
- Provider 默认关闭，失败必须隔离，不能阻塞 Token 看板或其他 provider。
- 原始凭据和响应不得返回浏览器、进入日志、导出、快照或社区同步。
- 使用脱敏 fixture 测试成功、认证失败、接口变化、无额度和格式错误。
- 更新 `NETWORK.md`、`PRIVACY.md`、威胁模型、设置文案和 NOTICE 来源。
- 如果接口不稳定或不能独立验证，显示不可用，不生成猜测数据。

### 本地看板与海报

- 保持桌面与窄屏都可完成任务，不能只检查一张标准屏截图。
- 交互必须支持键盘，dialog 需管理焦点和 Escape，图表数据需要可解释 tooltip/文案。
- 不引入远程脚本、字体、图片或遥测；生产资产必须本地打包。
- 导出要处理 CSV 公式注入，并明确私人 JSON 可能包含的字段。
- 海报不得出现 localhost URL、无效二维码、项目、设备、路径或对话内容。
- 视觉改动同时验证深浅主题、中英文、空数据和大数值。

### 同步、协议或 daemon

- 4xx 不应盲目重试；网络/5xx 重试必须有界。
- Checkpoint 只在成功批次后提交；partial/skipped/failed 来源保留旧状态。
- 协议新增字段先做本地和服务端验证，隐私默认拒绝。
- Daemon 必须用户级、可查看、可重启、可卸载；打开看板不能自动安装。
- 平台命令必须有不触碰真实调度器的 descriptor 单测。
- 升级、删除、撤销和重新上传行为要在 CLI/UI/文档中保持一致。

### 价格与模型目录

- 使用供应商官方标准 API 价格，记录来源 URL、验证时间与生效区间。
- 不把 batch/flex/priority 或长上下文价当成默认 standard 价。
- 未匹配模型保留 Token 并标为未定价，不能按 0 美元处理。
- 添加跨价格生效时间和费用守恒测试。

## 隐私检查清单

提交前确认：

- [ ] 没有 prompt、response、reasoning 文本、tool result 或文件内容。
- [ ] 没有真实 Cookie、Token、API Key、邮箱、账户 ID 或完整路径。
- [ ] 没有新增未记录的读取位置、环境变量、网络域名或上传字段。
- [ ] 本地-only 能力没有被意外绑到社区登录或同步。
- [ ] `doctor --json` 仍然适合公开 Issue，且新错误会脱敏路径。
- [ ] 浏览器响应、导出和日志不包含 provider 原始凭据/响应。

## Fixture 规范

- 使用明显虚构的账户、项目、ID、模型和时间。
- 只保留触发行为所需的最小字段，删除对话正文。
- Session ID 不得来自真实用户；凭据必须是不可用的测试字符串。
- 固定时间与预期汇总，避免 `Date.now()` 让测试漂移。
- 如果 fixture 来自第三方开源项目，核对许可证并更新 NOTICE。

## Commit 与 Pull Request

- 一个 PR 解决一个清晰问题；避免把格式化、重构和新功能混在一起。
- Commit 使用简洁的 Conventional Commit 风格，例如：

  ```text
  fix(codex): preserve reasoning tokens across fork replay
  feat(limits): add provider quota fixture
  docs: add parser compatibility matrix
  ```

- PR 描述至少包含：问题、实现、隐私/网络影响、验证方式、平台与 UI 截图（适用时）。
- 说明是否改动协议、读取目录、网络目标、配置 schema、NOTICE 或发布内容。
- 不要提交生成的 `dashboard/dist/`；发布构建会重新产生它。

## 引用与来源

从其他项目改编代码、协议映射、fixture 或显著交互时，必须：

1. 记录项目、URL、许可证和适用文件；
2. 在代码改编、产品参考和打包依赖之间做准确区分；
3. 更新 [NOTICE](./NOTICE)，不把“看过”写成共同所有，也不把实质改编写成普通灵感；
4. 确认许可证与本项目分发方式兼容。

## 行为准则

尊重维护者和报告者；讨论技术事实而不是身份。不要要求用户公开敏感日志来证明问题，也不要
因为某个 provider 难以接入就鼓励规避其安全控制。安全问题使用
[SUPPORT.md](./SUPPORT.md) 中的私密渠道，不在公开 Issue 披露漏洞细节。
