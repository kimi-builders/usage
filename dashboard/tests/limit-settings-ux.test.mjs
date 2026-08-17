import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* 源码钉(20260816):权益设置弹窗重构——权益标注随平台走、分区锚点、
   dirty 守卫、校验前置、刷新间隔移至权益中心页脚。
   20260816 拆分后:弹窗族在 LimitSettingsDialog.jsx,权益中心在 SubscriptionLimits.jsx。 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const dialog = () => read('../src/LimitSettingsDialog.jsx');
const center = () => read('../src/SubscriptionLimits.jsx');

test('entitlement classification lives inside each provider panel, not a standalone block', async () => {
  const jsx = await dialog();
  assert.match(jsx, /function EntitlementBlock\(/);
  assert.match(jsx, /item\.enabled && provider\.id !== 'opencode' \? <EntitlementBlock/);
  // 权益说明只在面板里出现一次;独立的成本大区块与重复说明已删除
  assert.doesNotMatch(jsx, /subscription-cost-settings/);
  assert.doesNotMatch(jsx, /subscription-entitlement-note/);
  // 列表卡用徽标提示口径
  assert.match(jsx, /entitlement-badge--\$\{entitlementItem\.entitlementType \|\| 'unknown'\}/);
});

test('provider cards render an entitlement badge only when enabled', async () => {
  const jsx = await dialog();
  assert.match(jsx, /\{item\.enabled \? <em className=\{`entitlement-badge/);
  assert.match(jsx, /entitlementBadge\(entitlementItem\.entitlementType, zh\)/);
  // 缩写徽标悬浮/读屏给全称
  assert.match(jsx, /title=\{entitlementLabel\(entitlementItem\.entitlementType, zh\)\}/);
});

test('section anchor nav sticks to the scroll body and tracks the active section', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  assert.match(jsx, /className="limit-section-nav"/);
  assert.match(jsx, /setActiveAnchor\(atBottom \|\| orderTop <= bodyTop \+ 120/);
  assert.match(css, /\.limit-section-nav \{ position: sticky; top: 0;/);
  assert.match(css, /\.limit-section \{ scroll-margin-top: 44px; \}/);
});

test('dirty guard intercepts close and escape instead of discarding silently', async () => {
  const jsx = await dialog();
  assert.match(jsx, /const dirty = JSON\.stringify\(draft\) !== JSON\.stringify\(settings\)/);
  assert.match(jsx, /hasEnteredSecrets\(accountSecrets\)/);
  assert.match(jsx, /closeStateRef\.current = \{ dirty, confirmDiscard \}/);
  assert.match(jsx, /closeStateRef\.current\.confirmDiscard/);
  assert.match(jsx, /const requestClose = \(\) => \{/);
  assert.match(jsx, /dialog-dirty-bar/);
  assert.match(jsx, /放弃并关闭/);
});

test('openCode account name, cookie, and workspace validation fires on blur', async () => {
  const jsx = await dialog();
  assert.match(jsx, /const fieldError = \(accountId, kind\) => \{/);
  assert.equal((jsx.match(/isValidOpenCodeWorkspaceId\(account\.workspaceId\)/g) || []).length, 2);
  assert.match(jsx, /\[`label:\$\{account\.id\}`\]: true/);
  assert.match(jsx, /onBlur=\{\(\) => setTouched\(\(current\) => \(\{ \.\.\.current, \[`cookie:\$\{account\.id\}`\]: true \}\)\)\}/);
  assert.match(jsx, /\[`workspace:\$\{account\.id\}`\]: true/);
  assert.match(jsx, /每个账户都必须填写名称、Cookie 与有效的 wrk_… Workspace ID/);
});

test('every OpenCode account card owns its name, Cookie, and Workspace fields', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  assert.match(jsx, /className="opencode-account-label"/);
  assert.match(jsx, /className="opencode-cookie-field"/);
  assert.match(jsx, /className="opencode-workspace-field"/);
  assert.match(css, /\.opencode-account-list fieldset \{[^}]*grid-template-columns: 24px minmax\(0,1fr\) auto/);
  assert.match(css, /\.opencode-account-list \.opencode-cookie-field \{ grid-column: 2 \/ -1;/);
  assert.match(css, /\.opencode-account-list \.opencode-workspace-field \{ grid-column: 2 \/ -1; grid-row: 3;/);
  assert.doesNotMatch(jsx, /Workspace discovery is automatic/);
});

test('every OpenCode account owns subscription metadata instead of sharing a provider block', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  assert.match(jsx, /<EntitlementFields className="account-entitlement" item=\{account\}/);
  assert.match(jsx, /item\.enabled && provider\.id !== 'opencode'/);
  assert.match(css, /\.opencode-account-list \.account-entitlement \{[^}]*grid-column: 2 \/ -1;[^}]*grid-row: 4;/);
});

test('save actions separate in-place quota refresh from save-and-close', async () => {
  const jsx = await dialog();
  assert.match(jsx, /保存并刷新额度/);
  assert.match(jsx, /保存并关闭/);
  assert.match(jsx, /submit\(\{ closeAfterSave: true \}\)/);
  assert.match(jsx, /if \(closeAfterSave\) \{ onClose\(\); return; \}/);
});

test('dialog backdrops never dismiss settings or generic dialogs', async () => {
  const settingsDialog = await dialog();
  const genericDialogs = await read('../src/UsageDialogs.jsx');
  for (const source of [settingsDialog, genericDialogs]) {
    assert.doesNotMatch(source, /className="dialog-layer"[^>]*onMouseDown/);
  }
});

test('refresh interval moved from the dialog to the benefit center footer', async () => {
  const limits = await center();
  const dialogJsx = await dialog();
  const app = await read('../src/App.jsx');
  const css = await read('../src/styles.css');
  assert.doesNotMatch(dialogJsx, /className="refresh-setting"/);
  assert.match(limits, /onRefreshIntervalChange/);
  assert.match(limits, /className="refresh-inline"/);
  assert.match(app, /onRefreshIntervalChange=\{limitSettings \? async \(minutes\)/);
  assert.doesNotMatch(css, /\.refresh-setting \{/);
});

test('expanded provider cards stay in the grid flow instead of spanning full width', async () => {
  const css = await read('../src/styles.css');
  assert.doesNotMatch(css, /article\.expanded \{ grid-column: 1 \/ -1; \}/);
});

test('save failures pin above the actions via a sticky alert layer', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  assert.match(jsx, /className="limit-sticky-alerts"/);
  assert.match(css, /\.limit-sticky-alerts \{ position: sticky; bottom: 0;/);
  assert.match(css, /\.limit-sticky-alerts:empty \{ display: none; \}/);
});

test('component modules export only components so Fast Refresh keeps local state', async () => {
  // vite Fast Refresh 要求组件文件只导出组件;纯函数在 utils,测试从 utils 引用
  const dialogJsx = await dialog();
  const limits = await center();
  const utils = await read('../src/subscription-limits-utils.js');
  for (const [name, src] of [['LimitSettingsDialog.jsx', dialogJsx], ['SubscriptionLimits.jsx', limits]]) {
    const exports = [...src.matchAll(/^export (?:function|const) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    assert.ok(exports.length > 0, `${name} should export components`);
    for (const exported of exports) assert.match(exported, /^[A-Z]/, `${name} exports non-component "${exported}"`);
  }
  assert.match(utils, /export function limitWindowDetail/);
  assert.match(utils, /export function resetCreditPresentation/);
  assert.match(utils, /export const ENTITLEMENT_TYPES/);
});
