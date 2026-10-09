import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { kimiConnectionStatusText, resetTabTarget } from '../src/subscription-limits-utils.js';

const account = (source, state) => ({ connectionType: source === 'local' ? 'local' : 'api-key',
  authMode: source, environmentVariable: 'KIMI_WORK', hasSecret: false, credentialState: 'absent',
  connectionStatus: { source, state, connectionType: source === 'local' ? 'local' : 'api-key', environmentVariable: 'KIMI_WORK' },
});

test('Kimi account status copy describes the actual connection, not missing Keychain storage', () => {
  for (const [source, state, zh, en] of [
    ['local', 'present', '已检测到本机登录', 'Local login detected'],
    ['local', 'expired', '本机登录已过期', 'Local login expired'],
    ['local', 'absent', '未检测到本机登录', 'Local login not found'],
    ['environment', 'present', '环境变量已配置', 'Environment variable configured'],
    ['environment', 'absent', '环境变量未设置或为空', 'Environment variable missing or empty'],
    ['keychain', 'present', '凭据已保存到钥匙串', 'Credential saved in Keychain'],
    ['keychain', 'absent', '钥匙串中未保存凭据', 'No credential saved in Keychain'],
  ]) {
    assert.equal(kimiConnectionStatusText(account(source, state), true), zh);
    assert.equal(kimiConnectionStatusText(account(source, state), false), en);
  }
  for (const source of ['local', 'environment', 'keychain']) {
    assert.match(kimiConnectionStatusText(account(source, 'unchecked'), false), /not checked/);
    assert.match(kimiConnectionStatusText({ ...account(source, 'present'), connectionStatus: undefined }, true), /尚未检测/);
  }
});

test('edited connection methods and environment names cannot retain an old ready badge', () => {
  const old = account('environment', 'present');
  for (const patch of [{ environmentVariable: 'NEW_KEY' }, { authMode: 'keychain' }, { connectionType: 'local', authMode: 'local' }, { connectionType: 'web-token' }]) {
    assert.match(kimiConnectionStatusText({ ...old, ...patch }, false), /not checked/);
  }
});

test('Kimi readiness stays visible on mobile instead of disappearing with secondary account copy', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.kimi-accounts-config \.account-row-main > small \{ display: block; grid-column: 1 \/ -1; grid-row: 2; white-space: normal;/);
});

test('reset window tabs wrap arrows, support Home/End, and do not intercept unrelated keys', async () => {
  for (const [key, current, expected] of [
    ['ArrowRight', 0, 1], ['ArrowRight', 1, 0], ['ArrowLeft', 0, 1], ['ArrowLeft', 1, 0],
    ['Home', 1, 0], ['End', 0, 1], ['Tab', 0, null], ['Enter', 0, null], ['ArrowDown', 0, null],
  ]) assert.equal(resetTabTarget(key, current, 2), expected);
  assert.equal(resetTabTarget('End', 0, 0), null);
  const jsx = await readFile(new URL('../src/SubscriptionLimits.jsx', import.meta.url), 'utf8');
  assert.match(jsx, /tabIndex=\{resetBand === band \? 0 : -1\}/);
  assert.match(jsx, /onKeyDown=\{event => onResetKeyDown\(event, index\)\}/);
  assert.match(jsx, /setResetBand\(RESET_BANDS\[target\]\[0\]\)/);
  assert.match(jsx, /querySelectorAll\('\[role="tab"\]'\)\[target\]\?\.focus\(\)/);
});
