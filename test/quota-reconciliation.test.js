import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKimiCodeUsage } from '../src/limits/providers/kimi.js';
import { fetchAntigravityLimits } from '../src/limits/providers/antigravity.js';
import { assertProviderContract } from '../src/limits/contract.js';

function kimi({ detail = {}, window = {}, ratio = {}, weekly = null } = {}) {
  return parseKimiCodeUsage({
    limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE', ...window },
      detail: { limit: '100', used: '100', resetTime: '2026-10-06T13:23:46.915Z', ...detail } }],
    usage: weekly,
    usages: {
      limit_5h: { used_ratio: 0, reset_time: '2026-10-06T13:23:46Z', ...ratio },
      limit_7d: { used_ratio: 0.2, reset_time: '2026-10-12T00:00:00Z' },
      limit_month_total: { used_ratio: 0.5531, reset_time: '2026-10-22T00:00:00Z' },
    },
  });
}

test('Kimi reconciles exhausted counters with the same ratio cycle without requiring weekly counts', () => {
  const result = assertProviderContract('kimi-code', kimi());
  assert.equal(result.windows[0].usedPercent, 100);
  assert.equal(result.windows[0].remainingPercent, 0);
  assert.equal(result.windows[0].value, 100);
  assert.equal(result.windows[2].windowSeconds, null);
  assert.equal(result.windows[2].usedPercent, 55.31);
});

test('Kimi reconciliation respects reset tolerance, duration, missing/invalid counters and equality', () => {
  for (const change of [
    { detail: { resetTime: '2026-10-06T13:23:49Z' } },
    { detail: { resetTime: null } },
    { detail: { used: null } }, { detail: { used: '' } }, { detail: { used: true } },
    { detail: { used: -1 } }, { detail: { used: undefined, remaining: 101 } },
    { window: { duration: 60 } }, { window: { timeUnit: 'UNKNOWN' } },
  ]) assert.equal(kimi(change).windows[0].usedPercent, 0, JSON.stringify(change));
  assert.equal(kimi({ detail: { resetTime: '2026-10-06T13:23:48Z' } }).windows[0].usedPercent, 100);
  assert.equal(kimi({ detail: { used: undefined, remaining: '0' } }).windows[0].usedPercent, 100);
  const equal = kimi({ ratio: { used_ratio: 1 } }).windows[0];
  assert.equal(equal.value, undefined); // equal readings preserve ratio metadata
  assert.equal(equal.resetsAt, '2026-10-06T13:23:46.000Z');
  assert.equal(kimi({ weekly: { limit: '100', used: '90', resetTime: '2026-10-12T00:00:01Z' } }).windows[1].usedPercent, 90);
});

test('Antigravity unsupported consumer clients stop before any placeholder quota request', async () => {
  const calls = [];
  await assert.rejects(fetchAntigravityLimits({
    settings: { authMode: 'environment', environmentVariable: 'TEST_OAUTH' },
    environment: { TEST_OAUTH: 'fixture-token' },
    fetcher: async (url) => {
      calls.push(url);
      return Response.json({ ineligibleTiers: [{ reasonCode: 'GOOGLE_TOS_NOT_SUPPORTED_BY_CLIENT' }] });
    },
  }), (error) => error.code === 'unauthorized' && /Sign in again/.test(error.message));
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]), /loadCodeAssist$/);
});

test('Antigravity real project/tier ownership or other ineligibility reasons do not trigger false reauth', async () => {
  for (const override of [
    { currentTier: { id: 'paid' } }, { cloudaicompanionProject: 'fixture-project' },
    { ineligibleTiers: [{ reasonCode: 'OTHER_REASON' }] },
  ]) {
    const result = await fetchAntigravityLimits({
      settings: { authMode: 'environment', environmentVariable: 'TEST_OAUTH' },
      environment: { TEST_OAUTH: 'fixture-token' },
      fetcher: async (url) => Response.json(String(url).endsWith('loadCodeAssist')
        ? { ineligibleTiers: [{ reasonCode: 'GOOGLE_TOS_NOT_SUPPORTED_BY_CLIENT' }], ...override }
        : { groups: [{ displayName: 'Gemini', buckets: [{ bucketId: '5h', remainingFraction: 0.4 }] }] }),
    });
    assert.equal(result.windows[0].remainingPercent, 40);
  }
});
