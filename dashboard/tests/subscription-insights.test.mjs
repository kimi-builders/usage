import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSubscriptionInsights, subscriptionSourceIds } from '../src/subscription-insights.js';

const generatedAt = '2026-08-11T12:00:00.000Z';

function bucket(id, bucketStart, model, tokens, costMicros = tokens * 2) {
  return {
    id, source: 'codex', model, modelCanonical: model, bucketStart,
    inputTokens: tokens, cacheWriteInputTokens: 0, cacheReadInputTokens: 0,
    outputTokens: 0, reasoningOutputTokens: 0, totalTokens: tokens,
    requestCount: 5, costMicros, pricedTokens: tokens, unpricedTokens: 0, assumedTokens: 0,
  };
}

const snapshot = {
  generatedAt,
  buckets: [
    bucket(1, '2026-08-11T09:00:00.000Z', 'gpt-5.6-sol', 1_000, 4_000),
    bucket(2, '2026-08-11T10:00:00.000Z', 'gpt-5.6-terra', 500, 1_000),
    bucket(3, '2026-08-03T10:00:00.000Z', 'gpt-5.6-sol', 9_000, 36_000),
  ],
};

const limits = { providers: [{
  id: 'codex', label: 'Codex', status: 'ok', windows: [{
    id: 'primary', label: '5 小时', usedPercent: 25, remainingPercent: 75,
    resetsAt: '2026-08-11T14:00:00.000Z', windowSeconds: 18_000,
  }],
}] };

test('links a subscription window to local tokens without using usage-page filters', () => {
  const result = buildSubscriptionInsights(snapshot, limits);
  const window = result.providers[0].windows[0];
  assert.equal(window.localTotals.totalTokens, 1_500);
  assert.equal(window.estimatedCapacityTokens, 6_000);
  assert.equal(window.estimatedRemainingTokens, 4_500);
  assert.equal(window.monthlyEquivalentTokens, 864_000);
  assert.equal(result.providers[0].lifetimeTotals.totalTokens, 10_500);
});

test('builds model-only API-equivalent capacity scenarios and preserves uncertainty', () => {
  const window = buildSubscriptionInsights(snapshot, limits).providers[0].windows[0];
  const sol = window.modelScenarios.find((item) => item.id === 'gpt-5.6-sol');
  const terra = window.modelScenarios.find((item) => item.id === 'gpt-5.6-terra');
  assert.equal(sol.capacityTokens, 5_000);
  assert.equal(sol.remainingTokens, 3_750);
  assert.equal(terra.capacityTokens, 10_000);
  assert.equal(window.estimationConfidence, 'high');
});

test('does not fabricate token capacity when the provider reports zero consumption', () => {
  const value = structuredClone(limits);
  value.providers[0].windows[0].usedPercent = 0;
  value.providers[0].windows[0].remainingPercent = 100;
  const window = buildSubscriptionInsights(snapshot, value).providers[0].windows[0];
  assert.equal(window.estimatedCapacityTokens, null);
  assert.equal(window.modelScenarios[0].capacityTokens, null);
});

test('maps subscription providers to collector source ids', () => {
  assert.deepEqual(subscriptionSourceIds('copilot'), ['copilot-cli']);
  assert.deepEqual(subscriptionSourceIds('kimi-code'), ['kimi-code']);
});

test('keeps actual subscription spend separate from API-equivalent value', () => {
  const settings = { providers: { codex: {
    subscriptionPrice: 2400, subscriptionCurrency: 'usd', billingCycle: 'yearly', renewsAt: '2027-01-01',
  } } };
  const result = buildSubscriptionInsights(snapshot, limits, { settings });
  assert.equal(result.providers[0].subscription.monthlyPrice, 200);
  assert.equal(result.providers[0].subscription.renewsAt, '2027-01-01');
  assert.deepEqual(result.summary.spendByCurrency, { usd: 200, cny: 0 });
  assert.equal(result.summary.pricedSubscriptions, 1);
});
