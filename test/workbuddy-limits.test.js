import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWorkBuddyLimits, parseWorkBuddyCredential, parseWorkBuddyUsage, workBuddyReset } from '../src/limits/providers/workbuddy.js';
import { assertProviderContract } from '../src/limits/contract.js';
import { defaultLimitSettings } from '../src/limits/catalog.js';
import { buildSubscriptionInsights } from '../dashboard/src/subscription-insights.js';
import { compactLimitHistory } from '../src/limits/history.js';
import { saveLimitSettings } from '../src/limits/service.js';

const now = new Date('2026-10-08T12:00:00Z');
const item = (extra = {}) => ({ CapacityUnit: 'credits', CycleTotalCapacity: '100', CycleRemainCapacity: '70', CycleFrozenCapacity: '5', ...extra });
const payload = (...packages) => ({ code: 0, data: { Packages: packages, SubscriptionPackageName: 'Pro', UIN: 'private-uin' } });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const options = { settings: { authMode: 'environment', environmentVariable: 'WB_TEST' }, environment: { WB_TEST: JSON.stringify({ cookie: 'fixture=private', userAgent: 'FixtureBrowser' }) }, now };

test('invalid credentials abort the entire settings draft before any provider write or deletion', () => {
  for (const invalidSecrets of [
    { workbuddy: JSON.stringify({ cookie: 'fixture-cookie' }) },
    { 'jetbrains-ai': 'unsupported-manual-credential' },
  ]) {
    const current = defaultLimitSettings();
    current.providers.copilot.accounts = [{ id: 'old', label: 'Old GitHub account' }];
    const settings = structuredClone(current);
    settings.providers.copilot.accounts = []; // Would delete an unrelated credential.
    const original = { subscriptionLimits: current };
    const stored = new Map([['claude-code', 'original-claude'], ['copilot:old', 'original-github']]);
    const calls = [];
    assert.throws(() => saveLimitSettings({ settings,
      secrets: { 'claude-code': 'replacement-claude', ...invalidSecrets },
      clearSecrets: ['codex'], clearAccountSecrets: ['copilot:old'],
    }, { config: original,
      writeSecret: (key, value) => { calls.push('write'); stored.set(key, value); },
      deleteSecret: key => { calls.push('delete'); stored.delete(key); },
      save: () => calls.push('save'),
    }));
    assert.deepEqual(calls, []);
    assert.deepEqual([...stored], [['claude-code', 'original-claude'], ['copilot:old', 'original-github']]);
    assert.deepEqual(original.subscriptionLimits, current);
  }
});

test('valid cross-provider credentials and account removals still apply after preflight', () => {
  const settings = defaultLimitSettings();
  const calls = [];
  const tuple = JSON.stringify({ cookie: 'fixture-cookie', userAgent: 'FixtureBrowser' });
  saveLimitSettings({ settings, secrets: { 'claude-code': 'fixture-claude', workbuddy: tuple }, clearSecrets: ['warp'] }, {
    config: {}, writeSecret: key => calls.push(`write:${key}`), deleteSecret: key => calls.push(`delete:${key}`), save: () => calls.push('save'),
  });
  assert.ok(calls.includes('write:claude-code'));
  assert.ok(calls.includes('write:workbuddy'));
  assert.ok(calls.includes('delete:warp'));
  assert.equal(calls.at(-1), 'save');
});

test('WorkBuddy adds credit packages only, keeps reserved separate and strips account identifiers', () => {
  const result = assertProviderContract('workbuddy', parseWorkBuddyUsage(payload(item(), item({ CycleTotalCapacity: 50, CycleRemainCapacity: 40 }), { CapacityUnit: 'tokens' }), { now }));
  assert.equal(result.plan, 'Pro');
  assert.deepEqual(result.creditBalance, { total: 150, remaining: 110, reserved: 10, resetsAt: null });
  assert.equal(result.windows[0].value, 40);
  assert.equal(result.windows[0].windowSeconds, null);
  assert.doesNotMatch(JSON.stringify(result), /private-uin|UIN/);
});

test('WorkBuddy rollover, zero allowance, absent reserve and malformed packages are not fabricated', () => {
  const rollover = parseWorkBuddyUsage(payload(item({ CycleRemainCapacity: 120 })), { now });
  assert.equal(rollover.creditBalance.remaining, 120);
  assert.equal(rollover.windows[0].usedPercent, 0);
  const zero = parseWorkBuddyUsage(payload(item({ CycleTotalCapacity: 0, CycleRemainCapacity: 0, CycleFrozenCapacity: null })), { now });
  assert.equal(zero.status, 'ok'); assert.deepEqual(zero.windows, []); assert.equal(zero.creditBalance.reserved, null);
  for (const bad of [null, item({ CycleRemainCapacity: -1 }), item({ CycleTotalCapacity: true }), item({ CycleFrozenCapacity: 'no' })]) {
    assert.throws(() => parseWorkBuddyUsage(payload(bad)), { code: 'invalid_response' });
  }
  assert.throws(() => parseWorkBuddyUsage(payload(item({ CycleTotalCapacity: 1e12 }), item())), { code: 'invalid_response' });
  assert.throws(() => parseWorkBuddyUsage({ code: 1, data: { Packages: [] } }), { code: 'invalid_response' });
});

test('WorkBuddy cycle end is inclusive China time; malformed and expired dates stay unknown', () => {
  const reset = raw => workBuddyReset({ code: 0, data: { Accounts: [{ CapacityUnit: 'credits', CycleEndTime: raw }] } }, now);
  assert.equal(reset('2026-10-31 23:59:59'), '2026-10-31T16:00:00.000Z');
  for (const raw of ['2026-02-30 23:59:59', '2026-09-30 23:59:59', '2026-10-31', 0, '2026-10-31 24:00:00']) assert.equal(reset(raw), null);
});

test('WorkBuddy requires an explicit cookie/UA tuple and never sends it outside fixed hosts', async () => {
  for (const value of [null, 'a=b', '{}', '{"cookie":"private"}', JSON.stringify({ cookie: 'private\r\nX: y', userAgent: 'fixture' })]) {
    assert.throws(() => parseWorkBuddyCredential(value), error => error.code === 'not_configured' && !error.message.includes('private'));
  }
  const calls = [];
  const result = await fetchWorkBuddyLimits({ ...options, fetcher: async (url, request) => {
    calls.push(String(url)); assert.equal(new URL(url).origin, 'https://www.workbuddy.cn');
    assert.equal(request.redirect, 'error'); assert.equal(request.headers.Cookie, 'fixture=private');
    assert.equal(request.headers['User-Agent'], 'FixtureBrowser');
    if (String(url).endsWith('-summary')) return response(payload(item()));
    assert.equal(JSON.parse(request.body).PageSize, 100);
    assert.ok(JSON.parse(request.body).PackageCodes.length > 0);
    return response({}, 401);
  } });
  assert.equal(calls.length, 3); assert.equal(result.status, 'ok'); assert.equal(result.windows[0].resetsAt, null);
  assert.match(result.accountId, /^[a-f0-9]{32}$/); assert.doesNotMatch(JSON.stringify(result), /fixture=private/);
});

test('WorkBuddy failures never retry another credential and rotated cookies isolate evidence', async () => {
  let calls = 0;
  await assert.rejects(fetchWorkBuddyLimits({ ...options, fetcher: async () => { calls++; return response({}, 401); } }), { code: 'unauthorized' });
  assert.equal(calls, 1);
  const fetcher = async () => response(payload(item()));
  const one = await fetchWorkBuddyLimits({ ...options, fetcher });
  const two = await fetchWorkBuddyLimits({ ...options, fetcher, environment: { WB_TEST: JSON.stringify({ cookie: 'other=private', userAgent: 'FixtureBrowser' }) } });
  assert.notEqual(one.accountId, two.accountId);
});

test('WorkBuddy credits do not infer a 30-day cycle or attribute local Tokens to an unverified account', () => {
  const provider = assertProviderContract('workbuddy', parseWorkBuddyUsage(payload(item()), { now, resetsAt: '2026-10-31T16:00:00Z' }));
  const settings = defaultLimitSettings(); settings.enabled = true; settings.providers.workbuddy.enabled = true;
  const insights = buildSubscriptionInsights({ buckets: [], sessions: [] }, { providers: [provider] }, { settings, now: +now });
  assert.equal(insights.providers[0].localAttributionAvailable, false);
  assert.equal(insights.providers[0].windows[0].windowSeconds, null);
  const history = compactLimitHistory([{ observedAt: now.toISOString(), providers: [provider] }], { now: +now });
  assert.equal(history.length, 1);
  assert.doesNotMatch(JSON.stringify(history), /creditBalance|reserved|private-uin/);
});
