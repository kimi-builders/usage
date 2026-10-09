import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLimitSettings, publicLimitSettings } from '../../src/limits/catalog.js';
import { createLimitResource, reconcileLimitSnapshot } from '../src/limit-resource.js';
import { buildBenefitCapacityOverview, buildSubscriptionInsights, selectSubscriptionAccounts } from '../src/subscription-insights.js';
import { quotaErrorMessage, quotaUpdatedText } from '../src/subscription-limits-utils.js';

const at = '2026-10-08T12:00:00Z';
const now = Date.parse(at);
const makeSettings = () => publicLimitSettings(normalizeLimitSettings({ enabled: true, providers: {
  'kimi-code': { enabled: true, activeAccountId: 'local', accounts: [
    { id: 'local', label: 'Personal', connectionType: 'local' },
    { id: 'work', label: 'Work', connectionType: 'api-key', authMode: 'environment', environmentVariable: 'KIMI_WORK' },
    { id: 'removed', label: 'Removed', connectionType: 'api-key', authMode: 'keychain' },
  ] },
  'claude-code': { enabled: true, authMode: 'local' },
} }));
const quota = (id, accountId) => ({ id, label: id, status: 'ok', updatedAt: at,
  ...(accountId ? { accountId, accountLabel: accountId, historyAccountId: `scope-${accountId}` } : {}),
  windows: [{ id: 'session', label: '5H', unit: 'tokens', value: 20, limit: 100,
    usedPercent: 20, remainingPercent: 80, windowSeconds: 18000, resetsAt: '2026-10-08T14:00:00Z' }] });
const makeData = () => ({ enabled: true, providers: [
  { ...quota('kimi-code', 'local'), activeAccountId: 'local', accounts: ['local', 'work', 'removed'].map(id => quota('kimi-code', id)) },
  quota('claude-code'),
], history: { observations: [] } });
const usage = { generatedAt: at, buckets: [] };
const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(value), text: async () => 'failure' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(fetcher) {
  const state = {};
  const callbacks = Object.fromEntries(['Data', 'Settings', 'Loading', 'Error', 'SettingsLoading', 'SettingsError']
    .map(name => [`on${name}`, value => { state[name] = value; }]));
  return { state, resource: createLimitResource({ fetcher, ...callbacks }) };
}

test('saved removal + failed refresh reconciles counts, selectors, reset rows, and labels without discarding other quotas', async () => {
  const settings = makeSettings();
  const saved = structuredClone(settings);
  saved.providers['kimi-code'].accounts = saved.providers['kimi-code'].accounts.filter(a => a.id !== 'removed');
  saved.providers['kimi-code'].accounts[1].label = 'Work QA';
  const { state, resource } = harness(async (url, init) => url.includes('/settings')
    ? response(init?.method === 'POST' ? saved : settings) : init?.cache && url.includes('?') ? response(null, 500) : response(makeData()));
  await resource.loadSettings(); await resource.load();
  let acknowledged = false;
  assert.equal(await resource.save({ settings: saved }, { onSaved: () => { acknowledged = true; } }), null);
  assert.equal(acknowledged, true);
  assert.equal(state.SettingsLoading, false);
  assert.match(state.Error, /500/);
  const selected = selectSubscriptionAccounts(state.Data, { 'kimi-code': 'removed' });
  const insights = buildSubscriptionInsights(usage, selected, { settings: state.Settings, now });
  const overview = buildBenefitCapacityOverview(insights.providers, now);
  assert.equal(insights.summary.subscriptionAccounts, 3);
  assert.equal(overview.resetAccountCount, 3);
  assert.equal(overview.fiveHour.remainingTokens, 240);
  assert.deepEqual(insights.providers[0].accounts.map(a => a.accountLabel), ['Personal', 'Work QA']);
  assert.ok(overview.resetRows.every(row => row.accountId !== 'removed'));
  assert.equal(insights.providers[1].status, 'ok');
});

test('analytics itself excludes removed/disabled providers even when passed an unreconciled snapshot', () => {
  const settings = makeSettings();
  settings.providers['kimi-code'].accounts.splice(2, 1);
  settings.providers['claude-code'].enabled = false;
  const insights = buildSubscriptionInsights(usage, makeData(), { settings, now });
  assert.equal(insights.summary.subscriptionAccounts, 2);
  assert.equal(buildBenefitCapacityOverview(insights.providers, now).resetAccountCount, 2);
  settings.enabled = false;
  assert.deepEqual(buildSubscriptionInsights(usage, makeData(), { settings, now }).providers, []);
});

test('connection edits and secret replacement invalidate only that account, including history and current Token capacity', () => {
  const settings = makeSettings();
  for (const [patch, payload] of [
    [{ environmentVariable: 'OTHER_KEY' }, {}],
    [{ connectionType: 'web-token' }, {}],
    [{ authMode: 'keychain' }, {}],
    [{}, { accountSecrets: { 'kimi-code': { work: 'fixture-secret' } } }],
    [{}, { clearAccountSecrets: ['kimi-code:work'] }],
  ]) {
    const saved = structuredClone(settings);
    Object.assign(saved.providers['kimi-code'].accounts[1], patch);
    const data = makeData();
    data.history.observations = [{ observedAt: at, providers: [{ ...quota('kimi-code', 'work'), accountId: 'work' }] }];
    const next = reconcileLimitSnapshot(data, saved, settings, payload);
    const selected = selectSubscriptionAccounts(next, { 'kimi-code': 'work' });
    const insights = buildSubscriptionInsights(usage, selected, { settings: saved, now });
    assert.equal(insights.providers[0].quotaObservation.state, 'unavailable');
    assert.deepEqual(insights.providers[0].windows, []);
    assert.equal(buildBenefitCapacityOverview(insights.providers, now).fiveHour.remainingTokens, 240);
    assert.equal(next.providers[1].status, 'ok');
    assert.equal(JSON.stringify(next).includes('fixture-secret'), false);
  }
});

test('provider region/path/auth edits and clearing/replacing credentials cannot borrow balances or old history', () => {
  const settings = makeSettings();
  for (const [patch, payload] of [
    [{ authMode: 'keychain' }, {}], [{ customPath: 'other-path' }, {}], [{ site: 'china' }, {}],
    [{}, { secrets: { 'claude-code': 'fixture' } }], [{}, { clearSecrets: ['claude-code'] }],
  ]) {
    const saved = structuredClone(settings);
    Object.assign(saved.providers['claude-code'], patch);
    const data = makeData(); data.providers[1].balances = [{ currency: 'USD', total: 20 }];
    const next = reconcileLimitSnapshot(data, saved, settings, payload);
    assert.equal(next.providers[1].error.code, 'refresh_required');
    assert.equal(next.providers[1].balances, undefined);
    assert.equal(quotaErrorMessage(next.providers[1], false), 'Claude Code connection changed. Refresh quotas to read this account again.');
  }
  const paths = structuredClone(settings);
  paths.providers['claude-code'].customPath = 'credentials.json';
  const renamedPath = reconcileLimitSnapshot(makeData(), paths, paths,
    { settings: { providers: { 'claude-code': { ...paths.providers['claude-code'], customPath: '/private/new/credentials.json' } } } });
  assert.equal(renamedPath.providers[1].quotaInvalidated, true);
  assert.equal(JSON.stringify(renamedPath).includes('/private/new'), false);
});

test('metadata/cache interval edits retain evidence and account selection; new connections have no borrowed quota', () => {
  const settings = makeSettings();
  const saved = structuredClone(settings);
  saved.refreshMinutes = 5;
  Object.assign(saved.providers['kimi-code'].accounts[1], { label: 'Renamed', subscriptionPrice: 99, entitlementType: 'paid' });
  const next = reconcileLimitSnapshot(selectSubscriptionAccounts(makeData(), { 'kimi-code': 'work' }), saved, settings);
  assert.equal(next.providers[0].activeAccountId, 'work');
  assert.equal(next.providers[0].windows[0].limit, 100);
  assert.equal(next.providers[0].accountLabel, 'Renamed');
  saved.providers['kimi-code'].accounts.push({ id: 'new', label: 'New', connectionType: 'local' });
  const added = reconcileLimitSnapshot(next, saved, settings).providers[0].accounts.at(-1);
  assert.deepEqual(added.windows, []);
  assert.equal(added.updatedAt, null);
});

test('manual-to-local switch and removal of a duplicate owner wait for fresh ownership evidence', () => {
  const settings = makeSettings(); const saved = structuredClone(settings);
  const data = makeData(); data.providers[0].accounts[1].duplicateOf = 'local';
  saved.providers['kimi-code'].accounts.shift();
  const next = reconcileLimitSnapshot(data, saved, settings);
  assert.equal(next.providers[0].accounts[0].quotaInvalidated, true);
  assert.equal(next.providers[0].accounts[0].duplicateOf, undefined);
  const rotated = reconcileLimitSnapshot(data, settings, settings, { accountSecrets: { 'kimi-code': { local: 'new-fixture-owner' } } });
  assert.equal(rotated.providers[0].accounts[1].quotaInvalidated, true);
  const manual = { ...settings, providers: { opencode: { enabled: true, authMode: 'keychain', accounts: [{ id: 'one' }] } }, providerOrder: ['opencode'] };
  const local = { ...manual, providers: { opencode: { enabled: true, authMode: 'local', accounts: [] } } };
  assert.deepEqual(reconcileLimitSnapshot({ providers: [{ ...quota('opencode', 'one'), accounts: [quota('opencode', 'one')] }] }, local, manual).providers[0].windows, []);
});

test('late pre-save quota and settings reads cannot undo the saved configuration or its failed-refresh warning', async () => {
  const settings = makeSettings(); const saved = structuredClone(settings);
  saved.providers['kimi-code'].accounts.pop();
  const oldQuota = deferred(); const oldSettings = deferred();
  let quotas = 0; let reads = 0;
  const { state, resource } = harness(async (url, init) => url.includes('/settings')
    ? init?.method === 'POST' ? response(saved) : ++reads === 1 ? response(settings) : oldSettings.promise
    : ++quotas === 1 ? response(makeData()) : quotas === 2 ? oldQuota.promise : response(null, 500));
  await resource.loadSettings(); await resource.load();
  const pendingQuota = resource.load(); const pendingSettings = resource.loadSettings();
  await resource.save({ settings: saved });
  oldQuota.resolve(response(makeData())); oldSettings.resolve(response(settings));
  await Promise.all([pendingQuota, pendingSettings]);
  assert.equal(state.Settings.providers['kimi-code'].accounts.length, 2);
  assert.equal(state.Data.providers[0].accounts.length, 2);
  assert.match(state.Error, /500/);
  assert.equal(state.Loading, false);
});

test('older refresh failure cannot override a newer success, and failed saves leave current evidence intact', async () => {
  const old = deferred(); let calls = 0;
  const { state, resource } = harness(async (url, init) => init?.method === 'POST'
    ? response(null, 400) : ++calls === 1 ? old.promise : response(makeData()));
  const first = resource.load(); await resource.load(true);
  old.resolve(response(null, 500)); await first;
  assert.equal(state.Error, ''); assert.equal(state.Data.providers.length, 2);
  const evidence = state.Data;
  await assert.rejects(resource.save({ settings: makeSettings() }), /failure/);
  assert.equal(state.Data, evidence);
  assert.equal(state.SettingsLoading, false);
});

test('settings acknowledgment resets the saved baseline before the post-save quota request starts', async () => {
  const order = [];
  const { resource } = harness(async (url, init) => {
    if (init?.method === 'POST') return response(makeSettings());
    order.push('refresh');
    assert.deepEqual(order, ['acknowledged', 'refresh']);
    return response(null, 500);
  });
  await resource.save({ settings: makeSettings() }, { onSaved: () => order.push('acknowledged') });
  assert.deepEqual(order, ['acknowledged', 'refresh']);
});

test('missing or invalid quota timestamps never claim an update just happened', () => {
  for (const value of [null, undefined, '', 'invalid']) {
    assert.equal(quotaUpdatedText(value, now, false), 'Not read yet');
    assert.equal(quotaUpdatedText(value, now, true), '尚未读取');
  }
  assert.equal(quotaUpdatedText(at, now, false), 'Updated now');
  assert.equal(quotaUpdatedText('2026-10-08T11:55:00Z', now, true), '5 分钟前更新');
  assert.equal(quotaUpdatedText('2026-10-08T10:00:00Z', now, false), 'Updated 2h ago');
});
