# 发布清单

> [English](./PUBLISHING.md)

公开版本只由 `.github/workflows/release.yml` 生成。该工作流在 GitHub 托管 runner 上运行，
申请 OIDC 身份，验证支持的平台矩阵，保留 CycloneDX SBOM 和已审查 tarball，然后带
provenance 发布。完成一次性的引导发布后，后续使用 npm Trusted Publishing，不保存 npm
写入 token。

首次发布后，在 npmjs.com 为 `@kimi.builders/usage` 配置 GitHub Actions trusted
publisher：仓库为 `kimi-builders/usage`，workflow 文件名为 `release.yml`，操作为
`npm publish`。`package.json` 中的仓库地址必须与公开 GitHub 仓库完全一致。

未发布的包没有 npm 包设置页面，无法预先建立信任关系。因此首次发布使用一个短期 granular
access token 作为引导凭据：

1. 确认 npm 组织 `kimi.builders` 已存在，并且发布账户有权在该 scope 创建公开包。
2. 创建对 `@kimi.builders` scope 有读写权限、允许绕过 2FA、有效期尽可能短的 granular token。
3. 把它添加为公开 GitHub 仓库的 Actions secret `NPM_FIRST_PUBLISH_TOKEN`。绝不能把值写入
   Git、Issue 或日志。
4. 按下方正常流程发布第一个 GitHub Release。
5. `@kimi.builders/usage` 创建后立刻配置 trusted publisher，删除 GitHub secret，并撤销
   引导 token。后续版本只使用 OIDC；工作流不需要保存 npm token。

## 发布前

1. 使用干净的发布分支并检查 `git status`。
2. 确认 `package.json` 的公开版本，并更新匹配的中文
   `docs/RELEASE_NOTES_<version>.md` 和英文
   `docs/RELEASE_NOTES_<version>.en.md` 发布说明。
3. 运行完整本地门禁：

   ```bash
   npm run release:check
   ```

   该命令会运行 Collector 测试、构建并测试看板，以及执行 `npm pack --dry-run`，从而显示
   精确的公开文件列表。

4. 运行仅供维护者使用的价格变化检查。任何差异都只是复核提示，必须回到供应商一方页面
   核实，禁止自动抄入目录：

   ```bash
   npm run check:pricing-drift
   ```

5. 在不安装服务的前提下验证三个后台服务 descriptor：

   ```bash
   node --test test/daemon.test.js
   ```

6. 从临时目录烟测安装包。测试连接或上传流程时，不要复用真实 Collector 配置。

## 干净 checkout 验证

脏的维护者工作区不能证明发布候选可靠。用精确的发布 commit 建立临时 checkout，按 lockfile
安装依赖，并在其中运行门禁：

```bash
git worktree add /tmp/kbu-usage-release-check HEAD
cd /tmp/kbu-usage-release-check
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix dashboard --ignore-scripts --no-audit --no-fund
npm run release:check
```

随后打包精确候选，在另一个空目录安装 tarball，并只检查本地/离线入口：

```bash
TARBALL="$(npm pack --ignore-scripts --silent --pack-destination /tmp/kbu-usage-release-artifact)"
mkdir -p /tmp/kbu-usage-install-smoke
cd /tmp/kbu-usage-install-smoke
npm init -y
npm install --ignore-scripts "/tmp/kbu-usage-release-artifact/$TARBALL"
./node_modules/.bin/kbu-usage --version
./node_modules/.bin/kbu-usage doctor --json
```

启动 `dashboard --no-open`，只运行到确认授权 loopback URL 和页面 shell，然后停止。不要在该
烟测目录运行 `init`、`sync` 或 `daemon install`。检查证据后移除两个临时目录和 worktree。

## 发布

1. 确认公开 GitHub remote 与 `package.json` 的 `repository.url` 完全一致，把已审查 release
   commit 推送到 `main`，并等待 CI。
2. 仅首次发布需要确认按上文安装了 `NPM_FIRST_PUBLISH_TOKEN`。后续版本应确认该 secret
   已不存在，并且 npm trusted publisher 仍把 `@kimi.builders/usage` 映射到 GitHub 仓库
   `kimi-builders/usage` 和 workflow `release.yml`。
3. 创建 GitHub Release，tag 必须精确为 `v<package.json version>`。
4. 发布 GitHub Release 会启动受保护的 npm 工作流。检查平台门禁、package audit、SBOM
   artifact 和 npm provenance 结果。
5. 首次发布后，在开始其他发布工作前完成 trusted publisher 迁移和 token 撤销。

不要从开发者电脑发布公开版本。`prepublishOnly` 是最后一道本地保护，但不能替代 CI 发布身份
和跨平台门禁。

## 发布后

```bash
npx @kimi.builders/usage@latest --version
npx @kimi.builders/usage@latest doctor
npx @kimi.builders/usage@latest dashboard
```

已安装后台服务的用户应运行：

```bash
npx @kimi.builders/usage@latest daemon restart
```

这会刷新用户级系统调度器中记录的绝对包/运行时路径，不会删除本地历史、社区连接或远端数据。

## 回滚与兼容性

发布前记录 npm 当前 `latest` 版本、已审核提交及一个已验证的稳定包。确认 GitHub 私密
漏洞报告及 Windows/macOS/Linux CI 已开启。依赖漏洞审计、真实供应商登录、npm provenance
仍需独立的在线发布检查；本机 fixture 通过不能替代这些证据。

出现回归时，由有权限的维护者把 `latest` dist-tag 恢复到记录的稳定版本，并对问题版本
执行 deprecate，附简短升级/降级指引。优先使用标签回滚和新的修复版本，不要覆盖旧版本、
复用版本号或贸然 unpublish。通过隔离安装验证恢复版本，再核验公开标签与 provenance。

降级前停止或卸载问题版本 daemon，安装稳定版本后主动 restart，更新调度器记录的绝对
运行路径。保留本机来源日志、配置、安装盐、checkpoint、额度历史和 `preferences.json`，
不要用删除数据来强制回滚。涉及迁移时先在本机备份 owner-only 文件。旧版看板可能忽略
新的偏好文件；JSON 消费工具可能需要适配版本 2 的新增字段，看板本身不提供 JSON
重新导入。社区同步仍为协议 v2。降级不应自动重置
checkpoint 或重放社区数据；兼容性未验证时先保持同步停止，再审核迁移/对账方案。
