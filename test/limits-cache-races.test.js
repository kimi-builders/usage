import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLimitCache, loadSubscriptionLimits } from '../src/limits/service.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const config = customPath => ({ subscriptionLimits: { enabled: true, providers: { codex: { enabled: true, customPath } } } });
const quota = usedPercent => ({ id: 'codex', label: 'Codex', status: 'ok', updatedAt: new Date().toISOString(), windows: [{ id: 'primary', label: '5H', usedPercent }] });
const options = { historyLoader: () => ({ observations: [] }) };

test('a cleared old query cannot repopulate quota cache/history or clear a newer in-flight query', async t => {
  clearLimitCache(); t.after(clearLimitCache);
  const old = deferred(); const next = deferred(); const recorded = []; let calls = 0;
  const shared = { ...options, config: config('local'), historyRecorder: value => recorded.push(value),
    fetchers: { codex: () => ++calls === 1 ? old.promise : next.promise } };
  const first = loadSubscriptionLimits(shared);
  clearLimitCache();
  const second = loadSubscriptionLimits(shared);
  old.resolve(quota(10)); await first;
  const third = loadSubscriptionLimits(shared);
  assert.equal(calls, 2);
  next.resolve(quota(40)); await Promise.all([second, third]);
  assert.equal(recorded.length, 1);
  assert.equal((await loadSubscriptionLimits(shared)).providers[0].windows[0].usedPercent, 40);
});

test('different connection settings do not share an old in-flight response; a late result cannot replace newer cache', async t => {
  clearLimitCache(); t.after(clearLimitCache);
  const old = deferred(); let calls = 0; const recorded = [];
  const shared = { ...options, historyRecorder: value => recorded.push(value), fetchers: { codex: () => ++calls === 1 ? old.promise : quota(50) } };
  const first = loadSubscriptionLimits({ ...shared, config: config('local') });
  await loadSubscriptionLimits({ ...shared, config: config('keychain') });
  old.resolve(quota(10)); await first;
  assert.equal((await loadSubscriptionLimits({ ...shared, config: config('keychain') })).providers[0].windows[0].usedPercent, 50);
  assert.equal(calls, 2); assert.equal(recorded.length, 1);
});

test('a forced newer refresh wins even if its old query finishes last', async t => {
  clearLimitCache(); t.after(clearLimitCache);
  const old = deferred(); let calls = 0;
  const shared = { ...options, config: config('local'), historyRecorder: () => {}, fetchers: { codex: () => ++calls === 1 ? old.promise : quota(80) } };
  const first = loadSubscriptionLimits(shared);
  await loadSubscriptionLimits({ ...shared, force: true });
  old.resolve(quota(10)); await first;
  assert.equal((await loadSubscriptionLimits(shared)).providers[0].windows[0].usedPercent, 80);
});

test('disabling the center invalidates running queries without recording their results', async t => {
  clearLimitCache(); t.after(clearLimitCache);
  const old = deferred(); const recorded = [];
  const shared = { ...options, config: config('local'), historyRecorder: result => recorded.push(result), fetchers: { codex: () => old.promise } };
  const first = loadSubscriptionLimits(shared);
  const off = await loadSubscriptionLimits({ ...shared, config: { subscriptionLimits: { enabled: false } } });
  assert.deepEqual(off.providers, []);
  old.resolve(quota(10)); await first;
  assert.equal(recorded.length, 0);
});

test('a late superseded Cursor 403 cannot reinstate cooldown after a successful refresh', async t => {
  clearLimitCache(); t.after(clearLimitCache);
  const old = deferred(); let calls = 0; let clock = Date.now();
  const shared = { ...options, now: () => clock,
    config: { subscriptionLimits: { enabled: true, refreshMinutes: 5, providers: { cursor: { enabled: true } } } },
    historyRecorder: () => {}, fetchers: { cursor: () => ++calls === 1 ? old.promise : { ...quota(40), id: 'cursor' } } };
  const first = loadSubscriptionLimits(shared);
  await loadSubscriptionLimits({ ...shared, force: true });
  old.resolve(Promise.reject(Object.assign(new Error('Denied'), { status: 403 })));
  await first;
  clock += 6 * 60_000;
  const retry = await loadSubscriptionLimits(shared);
  assert.equal(calls, 3);
  assert.equal(retry.providers[0].status, 'ok');
});
