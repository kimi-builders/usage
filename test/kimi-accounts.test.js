import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLimitSettings, publicLimitSettings } from '../src/limits/catalog.js';
import { fetchKimiLimits, parseKimiCodeUsage, parseKimiWebUsage } from '../src/limits/providers/kimi.js';
import { clearLimitCache, loadSubscriptionLimits, saveLimitSettings } from '../src/limits/service.js';
import { recordLimitSnapshot } from '../src/limits/history.js';

const apiAccount = (id, extra = {}) => ({ id, label: id, connectionType: 'api-key', authMode: 'environment', environmentVariable: `KEY_${id.toUpperCase()}`, ...extra });
const settingsFor = accounts => normalizeLimitSettings({ enabled: true, providers: { 'kimi-code': { enabled: true, accountsInitialized: true, accounts } } });
const quota = (id, used = 0.2) => ({ user: id == null ? {} : { id }, usages: {
  limit_5h: { used_ratio: used, reset_time: '2026-10-08T18:00:00Z' },
  limit_month_total: { used_ratio: 0.4, reset_time: '2026-11-01T00:00:00Z' },
} });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const noHistory = { historyLoader: () => ({ observations: [] }), historyRecorder: () => {} };
function temp(t) {
  const root = mkdtempSync(join(tmpdir(), 'kbu-kimi-accounts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Kimi migrates local or legacy web credentials and declared spend once; deleted accounts never return', () => {
  for (const authMode of ['local', 'keychain', 'environment']) {
    const settings = normalizeLimitSettings({ providers: { 'kimi-code': { enabled: true, authMode, environmentVariable: 'OLD_KIMI', subscriptionPrice: 19 } } });
    const item = settings.providers['kimi-code'];
    assert.equal(item.accounts.length, 1);
    assert.equal(item.accounts[0].connectionType, authMode === 'local' ? 'local' : 'web-token');
    assert.equal(item.accounts[0].legacyCredential, true);
    assert.equal(item.accounts[0].subscriptionPrice, 19);
    assert.equal(item.subscriptionPrice, null);
    assert.deepEqual(normalizeLimitSettings(settings), settings);
    item.accounts = [];
    assert.deepEqual(normalizeLimitSettings(settings).providers['kimi-code'].accounts, []);
  }
  assert.doesNotThrow(() => normalizeLimitSettings({ providers: { 'kimi-code': { accounts: {} } } }));
});

test('Kimi public settings probe each stored key independently without returning credentials', () => {
  const settings = settingsFor([apiAccount('a', { authMode: 'keychain' }), apiAccount('b', { authMode: 'keychain' })]);
  const publicSettings = publicLimitSettings(settings, { hasSecret: key => key === 'kimi-code:a' });
  assert.deepEqual(publicSettings.providers['kimi-code'].accounts.map(a => a.hasSecret), [true, false]);
  const legacy = normalizeLimitSettings({ providers: { 'kimi-code': { authMode: 'keychain' } } });
  assert.equal(publicLimitSettings(legacy, { hasSecret: key => key === 'kimi-code' }).providers['kimi-code'].accounts[0].hasSecret, true);
});

test('Kimi saves and removes isolated credentials, preserves blank existing secrets, validates before any mutation', () => {
  const stored = new Map(); let config = { sessionSalt: 'fixture-salt' }; let mutations = 0;
  const options = { writeSecret: (id, value) => { mutations++; stored.set(id, value); }, deleteSecret: id => { mutations++; stored.delete(id); }, save: next => { mutations++; config = next; } };
  const settings = settingsFor([apiAccount('a', { authMode: 'keychain' }), apiAccount('b', { authMode: 'keychain' })]);
  const result = saveLimitSettings({ settings, accountSecrets: { 'kimi-code': { a: 'fixture-secret-a', b: 'fixture-secret-b' } } }, { ...options, config });
  assert.equal(stored.get('kimi-code:a'), 'fixture-secret-a');
  assert.equal(stored.get('kimi-code:b'), 'fixture-secret-b');
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  assert.ok(!JSON.stringify(config).includes('fixture-secret'));
  const before = mutations;
  const invalid = structuredClone(settings);
  invalid.providers['kimi-code'].accounts.push(apiAccount('c', { authMode: 'keychain' }));
  assert.throws(() => saveLimitSettings({ settings: invalid }, { ...options, config }), /重新填写/);
  assert.equal(mutations, before);
  saveLimitSettings({ settings }, { ...options, config });
  assert.equal(stored.get('kimi-code:a'), 'fixture-secret-a');
  settings.providers['kimi-code'].accounts.shift();
  saveLimitSettings({ settings }, { ...options, config });
  assert.equal(stored.has('kimi-code:a'), false);
  assert.equal(stored.get('kimi-code:b'), 'fixture-secret-b');
});

test('Kimi rejects duplicate local slots and credential-mode changes without fresh credentials', () => {
  const settings = settingsFor([apiAccount('a', { authMode: 'keychain', connectionType: 'web-token' })]);
  const config = { subscriptionLimits: settings };
  const draft = structuredClone(settings);
  draft.providers['kimi-code'].accounts[0].connectionType = 'api-key';
  const options = { config, writeSecret: () => assert.fail('must validate first'), deleteSecret: () => assert.fail('must validate first'), save: () => assert.fail('must validate first') };
  assert.throws(() => saveLimitSettings({ settings: draft }, options), /重新填写/);
  draft.providers['kimi-code'].accounts = [{ id: 'a', connectionType: 'local' }, { id: 'b', connectionType: 'local' }];
  assert.throws(() => saveLimitSettings({ settings: draft }, options), /1 个本机登录/);
});

test('Kimi API keys use only the Coding endpoint; identities are opaque, scoped, stable and owner-aware', async () => {
  const queries = [];
  const load = (key, owner, salt = 'installation-one') => fetchKimiLimits({ settings: apiAccount('a'), environment: { KEY_A: key }, identitySalt: salt,
    fetcher: async (url, options) => { queries.push({ url, options }); return json(quota(owner)); } });
  const a = await load('fixture-secret-a', 'owner-1');
  const b = await load('fixture-secret-b', 'owner-1');
  const c = await load('fixture-secret-c', 'owner-2');
  assert.equal(a.historyAccountId, b.historyAccountId);
  assert.notEqual(a.credentialId, b.credentialId);
  assert.notEqual(a.historyAccountId, c.historyAccountId);
  assert.notEqual(a.historyAccountId, (await load('fixture-secret-a', 'owner-1', 'installation-two')).historyAccountId);
  assert.notEqual((await load('fixture-secret-a', null)).historyAccountId, (await load('fixture-secret-b', null)).historyAccountId);
  assert.equal((await load('fixture-secret-a', null)).accountIdentityVerified, false);
  assert.deepEqual(a.windows.map(w => w.id), ['session', 'month-total']);
  assert.equal(a.windows[1].windowSeconds, null);
  assert.ok(!JSON.stringify(a).includes('owner-1'));
  assert.ok(!JSON.stringify(a).includes('fixture-secret-a'));
  assert.ok(queries.every(query => String(query.url) === 'https://api.kimi.com/coding/v1/usages' && !query.options.headers.Cookie));
});

test('Kimi API-key 401 never falls back to local login, web tokens, or OAuth refresh', async () => {
  let calls = 0;
  await assert.rejects(fetchKimiLimits({ settings: apiAccount('a'), environment: { KEY_A: 'fixture-invalid' },
    fetcher: async url => { calls++; assert.equal(String(url), 'https://api.kimi.com/coding/v1/usages'); return json({}, 401); } }), { code: 'unauthorized' });
  assert.equal(calls, 1);
});

test('Kimi local login coexists with keys, failures stay per-account and verified duplicate owners are not counted twice', async t => {
  clearLimitCache(); t.after(clearLimitCache);
  const root = temp(t);
  mkdirSync(join(root, 'credentials'));
  const path = join(root, 'credentials/kimi-code.json');
  const login = JSON.stringify({ access_token: 'fixture-local-token', expires_at: Date.now() / 1000 + 3600 });
  writeFileSync(path, login);
  const settings = settingsFor([{ id: 'local', label: 'Local', connectionType: 'local' }, apiAccount('a'), apiAccount('b'), apiAccount('bad')]);
  const result = await loadSubscriptionLimits({ force: true, config: { subscriptionLimits: settings, sessionSalt: 'fixture' }, ...noHistory,
    environment: { KIMI_CODE_HOME: root, KIMI_SHARE_DIR: root, KEY_A: 'fixture-key-a', KEY_B: 'fixture-key-b', KEY_BAD: 'fixture-key-bad' },
    fetcher: async (url, options) => {
      assert.equal(String(url), 'https://api.kimi.com/coding/v1/usages');
      const token = options.headers.Authorization;
      if (token.endsWith('-bad')) return json({ message: 'must not leak fixture-key-bad' }, 401);
      return json(quota(token.endsWith('-b') ? 'owner-b' : 'owner-a'));
    } });
  const accounts = result.providers[0].accounts;
  assert.deepEqual(accounts.map(a => a.status), ['ok', 'ok', 'ok', 'error']);
  assert.equal(accounts[1].duplicateOf, 'local');
  assert.equal(accounts[2].duplicateOf, undefined);
  assert.equal(accounts[3].error.code, 'unauthorized');
  assert.equal(readFileSync(path, 'utf8'), login);
  assert.ok(!JSON.stringify(result).includes('fixture-key'));
  const history = recordLimitSnapshot(result, { path: join(root, 'history.json') });
  assert.equal(history.observations[0].providers.length, 2);
  assert.equal(history.observations[0].providers[0].accountId, accounts[0].historyAccountId);
  assert.ok(!JSON.stringify(history).includes('credentialId'));
});

test('Kimi initialized empty account lists do not silently query the local CLI login', async () => {
  const result = await loadSubscriptionLimits({ force: true, config: { subscriptionLimits: settingsFor([]) }, ...noHistory,
    fetcher: () => assert.fail('no account, no network') });
  assert.equal(result.providers[0].error.code, 'not_configured');
  clearLimitCache();
});

test('Kimi duplicate keys without an owner ID share one quota, and local-only saves get a persistent identity salt', async () => {
  const settings = settingsFor([apiAccount('a'), apiAccount('b'), apiAccount('c')]);
  let config = {};
  saveLimitSettings({ settings }, { config, writeSecret: () => assert.fail(), deleteSecret: () => {}, save: value => { config = value; } });
  assert.match(config.quotaIdentitySalt, /^[a-f0-9]{64}$/);
  const firstSalt = config.quotaIdentitySalt;
  saveLimitSettings({ settings }, { config, writeSecret: () => assert.fail(), deleteSecret: () => {}, save: value => { config = value; } });
  assert.equal(config.quotaIdentitySalt, firstSalt);
  const result = await loadSubscriptionLimits({ force: true, config, ...noHistory,
    environment: { KEY_A: 'same-key', KEY_B: 'same-key', KEY_C: 'different-key' }, fetcher: async () => json(quota(null)) });
  assert.equal(result.providers[0].accounts[1].duplicateOf, 'a');
  assert.equal(result.providers[0].accounts[2].duplicateOf, undefined);
  clearLimitCache();
});

test('Kimi quota parsing omits missing weekly and monthly facts and selects the actual five-hour limit', () => {
  assert.deepEqual(parseKimiCodeUsage(quota(null)).windows.map(w => w.id), ['session', 'month-total']);
  const legacy = parseKimiCodeUsage({ limits: [
    { window: { duration: 7, timeUnit: 'TIME_UNIT_DAY' }, detail: { used: 90, limit: 100 } },
    { window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' }, detail: { used: 25, limit: 100 } },
  ], usage: { used: 10, limit: 100 } });
  assert.equal(legacy.windows[0].usedPercent, 25);
  assert.equal(legacy.windows[1].id, 'weekly');
  assert.equal(parseKimiWebUsage({}, { ratelimitCode7d: { ratio: null }, subscriptionBalance: { amountUsedRatio: '' } }).windows.length, 0);
});
