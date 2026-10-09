import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* 源码钉:权益设置弹窗——权益标注随平台/账户走、主从布局(20261010)、
   dirty 守卫、校验前置、刷新间隔移至权益中心页脚。
   20261010 重构:弹窗改为左栏平台导航 + 右栏当前平台详情;
   多账号平台拆成「账号行列表 + 单账号编辑卡」;旧长滚动分区锚点移除。 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const dialog = () => read('../src/LimitSettingsDialog.jsx');
const center = () => read('../src/SubscriptionLimits.jsx');

test('entitlement classification lives inside each provider detail, not a standalone block', async () => {
  const jsx = await dialog();
  assert.match(jsx, /function EntitlementBlock\(/);
  // 单账号平台的标注块仅在启用时渲染,且随详情面板出现
  assert.match(jsx, /item\.enabled && provider\.id !== 'opencode' && provider\.id !== 'kimi-code' \? <section className="detail-group">/);
  assert.match(jsx, /<EntitlementBlock provider=\{provider\} item=\{item\} updateProvider=\{updateProvider\} zh=\{zh\}\/>/);
  // 权益说明只在面板里出现一次;独立的成本大区块与重复说明已删除
  assert.doesNotMatch(jsx, /subscription-cost-settings/);
  assert.doesNotMatch(jsx, /subscription-entitlement-note/);
  // 列表行用徽标提示口径
  assert.match(jsx, /entitlement-badge--\$\{entitlementItem\.entitlementType \|\| 'unknown'\}/);
});

test('provider rows and detail head render an entitlement badge only when enabled', async () => {
  const jsx = await dialog();
  assert.match(jsx, /\{item\.enabled \? <em className=\{`entitlement-badge/);
  assert.match(jsx, /entitlementBadge\(entitlementItem\.entitlementType, zh\)/);
  // 缩写徽标悬浮/读屏给全称
  assert.match(jsx, /title=\{entitlementLabel\(entitlementItem\.entitlementType, zh\)\}/);
});

test('master-detail layout keeps platform navigation and current settings separate', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  // 左栏导航 + 右栏详情;详情一次只渲染当前平台,不再双列卡片平铺
  assert.match(jsx, /className="limit-settings-layout"/);
  assert.match(jsx, /className="limit-settings-nav"/);
  assert.match(jsx, /className="limit-settings-detail" ref=\{detailRef\}/);
  assert.match(jsx, /const selectedProvider = selectedId === ORDER_NAV_ID \? null : catalogById\.get\(selectedId\) \|\| null;/);
  // 旧双列卡片容器已移除;tabpanel 的 id 契约(limit-provider-settings-panel)保留
  assert.doesNotMatch(jsx, /"limit-provider-settings"/);
  assert.doesNotMatch(css, /\.limit-provider-settings/);
  // 导航行选中态 + 排序入口,替代旧分区锚点
  assert.match(jsx, /aria-current=\{isSelected \? 'true' : undefined\}/);
  assert.match(jsx, /className=\{`limit-nav-order-entry\$\{selectedId === ORDER_NAV_ID \? ' selected' : ''\}`\}/);
  assert.match(css, /\.limit-settings-layout \{ flex: 1 1 auto; min-width: 0; min-height: 0; display: grid; grid-template-columns: 296px minmax\(0, 1fr\); \}/);
  // A fieldset introduces an anonymous content box that defeats the bounded grid.
  assert.match(jsx, /<div className="limit-settings-layout" inert=\{saving \|\| undefined\}/);
  assert.doesNotMatch(css, /\.limit-section-nav/);
  // 移动端只常驻当前平台,管理工具按需展开,详情独占下方滚动
  assert.match(css, /@media \(max-width: 900px\) \{[^@]*?\.limit-settings-layout \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows: auto minmax\(0, 1fr\); \}/s);
  // 详情滚动条留在内容视口内,不切穿标题与外圆角
  assert.match(css, /\.limit-settings-detail \{ min-width: 0; min-height: 0; overflow-y: auto;/);
  assert.match(jsx, /className="limit-mobile-navigation"[^>]*aria-expanded=\{mobileNavigation\}/);
  assert.match(css, /\[data-mobile-expanded="false"\] \.limit-navigation-controls \{ display: none;/);
  assert.match(jsx, /setMobileNavigation\(false\)/);
});

test('dirty guard intercepts close and escape instead of discarding silently', async () => {
  const jsx = await dialog();
  assert.match(jsx, /const dirty = isLimitSettingsDirty\(form\)/);
  assert.match(jsx, /closeStateRef\.current = \{ dirty, confirmDiscard, saving \}/);
  assert.match(jsx, /closeStateRef\.current\.confirmDiscard/);
  assert.match(jsx, /const requestClose = \(\) => \{/);
  assert.match(jsx, /dialog-dirty-bar/);
  assert.match(jsx, /放弃并关闭/);
});

test('settings acknowledgment precedes quota refresh and cannot be mistaken for a failed write', async () => {
  const app = await read('../src/App.jsx');
  const jsx = await dialog();
  assert.match(app, /return await limitResource\.save\(payload, \{ onSaved \}\)/);
  const resource = await readFile(new URL('../src/limit-resource.js', import.meta.url), 'utf8');
  assert.match(resource, /onSaved\?\.\(next\);\s*return load\(true\)/);
  assert.match(jsx, /onSaved: savedSettings => \{\s*dispatch\(\{ type: 'saved', settings: savedSettings, submitted: form \}\)/);
  assert.match(jsx, /设置已保存，但额度刷新失败/);
  assert.match(jsx, /disabled=\{saving \|\| copilotAuthorization !== 'idle'\}/);
  assert.match(app, /if \(!connectedSettings\) throw Object\.assign\(new Error/);
  assert.match(jsx, /statusCheck=\{copilotStatusCheck\}/);
  assert.match(jsx, /\[onCopilotDeviceAction, statusCheck\]/);
  assert.match(jsx, /element\.getClientRects\(\)\.length > 0 && !element\.closest\('\[inert\]'\)/);
});

test('OpenCode validates the selected per-account credential tuple on blur', async () => {
  const jsx = await dialog();
  assert.match(jsx, /const fieldError = \(accountId, kind\) => \{/);
  assert.equal((jsx.match(/isValidOpenCodeWorkspaceId\(account\.workspaceId\)/g) || []).length, 2);
  assert.match(jsx, /\[`label:\$\{(?:account|selected)\.id\}`\]: true/);
  assert.match(jsx, /\[`credential:\$\{(?:account|selected)\.id\}`\]: true/);
  assert.match(jsx, /\[`workspace:\$\{(?:account|selected)\.id\}`\]: true/);
  assert.match(jsx, /完整配置 API Key 或 Cookie \+ 有效的 wrk_… Workspace ID/);
  assert.match(jsx, /account\.connectionType !== 'api-key'/);
});

test('every OpenCode account owns its connection method and credential fields in the editor', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  assert.match(jsx, /className="opencode-account-label"/);
  assert.match(jsx, /className="opencode-connection-type"/);
  assert.match(jsx, /className="opencode-cookie-field"/);
  assert.match(jsx, /className="opencode-workspace-field"/);
  assert.match(jsx, /<option value="api-key">API Key<\/option>/);
  // 编辑卡两列布局:名称与连接方式并排,凭据字段整行
  assert.match(css, /\.opencode-account-list fieldset \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.opencode-account-list \.opencode-cookie-field \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.opencode-account-list \.opencode-workspace-field \{ grid-column: 1 \/ -1; \}/);
  assert.doesNotMatch(jsx, /Workspace discovery is automatic/);
});

test('every OpenCode account owns subscription metadata inside its editor footer', async () => {
  const jsx = await dialog();
  const css = await read('../src/styles.css');
  assert.match(jsx, /<EntitlementFields className="account-entitlement" item=\{selected\}/);
  assert.match(jsx, /item\.enabled && provider\.id !== 'opencode'/);
  // SUBSCRIPTION 标签与移除动作同处编辑卡页脚,不与凭据字段混排
  assert.match(css, /\.opencode-account-list \.account-entitlement::before \{ content: 'SUBSCRIPTION';/);
  assert.match(css, /\.opencode-account-list \.account-editor-footer \{ grid-column: 1 \/ -1;/);
});

test('removing an account with a saved credential asks before erasing it', async () => {
  const jsx = await dialog();
  assert.match(jsx, /function RemoveAccountButton\(/);
  assert.match(jsx, /hasSavedCredential=\{credentialState\((?:selected|account)\) !== 'absent'\}/);
  assert.match(jsx, /保存后将同时清除本机保存的凭据/);
  assert.match(jsx, /确认移除/);
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
  const genericDialogs = await read('../src/Dialog.jsx');
  for (const source of [settingsDialog, genericDialogs]) {
    assert.doesNotMatch(source, /className="dialog-layer"[^>]*onMouseDown/);
  }
});

test('generic dialog close control follows the dashboard locale', async () => {
  const genericDialog = await read('../src/Dialog.jsx');
  const app = await read('../src/App.jsx');
  assert.match(genericDialog, /aria-label=\{zh \? '关闭对话框' : 'Close dialog'\}/);
  assert.match(app, /<DialogLocaleProvider zh=\{zh\}>/);
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
