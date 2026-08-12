import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCycleCapacityStats, buildPortfolioReview, buildRenewalReview,
} from '../src/subscription-review.js';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

function cyclePoint(index, capacityTokens, {
  coverage = 1, usedPercent = 50, nearEndMinutes = 20,
} = {}) {
  const reset = Date.parse(`2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`);
  const localTokens = Math.round(capacityTokens * usedPercent / 100);
  return {
    observedAt: new Date(reset - nearEndMinutes * 60_000).toISOString(),
    resetsAt: new Date(reset).toISOString(),
    windowSeconds: 18_000,
    usedPercent,
    localCoverage: coverage,
    localTotals: { totalTokens: localTokens, costMicros: localTokens * 2 },
  };
}

test('builds a historical capacity interval only from complete, well-covered cycles', () => {
  const points = [
    cyclePoint(0, 1_000),
    cyclePoint(1, 1_200),
    cyclePoint(2, 1_400),
    cyclePoint(3, 1_600),
    cyclePoint(4, 90_000, { coverage: 0.4 }),
    cyclePoint(5, 80_000, { nearEndMinutes: 120 }),
  ];
  const stats = buildCycleCapacityStats(points, [{
    id: 'gpt-test', effectiveCostMicrosPerToken: 2,
  }], NOW);
  assert.equal(stats.completedCycles, 6);
  assert.equal(stats.sampledCycles, 4);
  assert.deepEqual([stats.low, stats.median, stats.high], [1_150, 1_300, 1_450]);
  assert.equal(stats.confidence, 'high');
  assert.equal(stats.stability, 'steady');
  assert.equal(stats.modelScenarios[0].median, 1_300);
  assert.equal(stats.modelScenarios[0].monthlyMedian, 187_200);
});

test('does not claim an interval from a partial or unfinished cycle', () => {
  const future = cyclePoint(20, 1_000);
  const partial = cyclePoint(0, 2_000, { coverage: 0.5 });
  const stats = buildCycleCapacityStats([future, partial], [], NOW);
  assert.equal(stats.sampledCycles, 0);
  assert.equal(stats.median, null);
  assert.equal(stats.confidence, 'none');
});

test('builds a renewal-period forecast only with sufficient local coverage', () => {
  const buckets = [{
    bucketStart: '2026-08-01T00:00:00.000Z', totalTokens: 1_000,
    requestCount: 10, costMicros: 20_000,
  }];
  const subscription = {
    renewsAt: '2026-08-20', billingCycle: 'monthly', price: 200, currency: 'usd',
  };
  const review = buildRenewalReview({
    buckets, subscription, sourceHistoryStart: Date.parse('2026-07-01T00:00:00.000Z'), now: NOW,
  });
  assert.equal(review.configured, true);
  assert.equal(review.daysRemaining, 8);
  assert.equal(review.coverage, 1);
  assert.ok(review.projectedTokens > 1_000);
  assert.ok(review.projectedApiEquivalentUsd > 0.02);
  assert.ok(review.projectedValueRatio > 0);

  const partial = buildRenewalReview({
    buckets, subscription, sourceHistoryStart: Date.parse('2026-08-10T00:00:00.000Z'), now: NOW,
  });
  assert.equal(partial.projectedTokens, null);
  assert.equal(partial.projectedValueRatio, null);
});

test('keeps month-end renewal dates on the end of shorter months', () => {
  const review = buildRenewalReview({
    buckets: [],
    subscription: { renewsAt: '2026-01-31', billingCycle: 'monthly', price: null, currency: 'usd' },
    sourceHistoryStart: null,
    now: Date.parse('2026-02-10T12:00:00.000Z'),
  });
  assert.equal(review.periodEnd.slice(0, 10), '2026-02-28');
  assert.equal(review.periodStart.slice(0, 10), '2026-01-31');
});

test('finds model-family overlap without calling it a duplicate subscription', () => {
  const provider = (id, label, rows, options = {}) => ({
    id, label,
    recentModelRows: rows,
    recentTotals: { totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0) },
    subscription: { monthlyPrice: options.price ?? null },
    renewalReview: options.renewal || { configured: false },
  });
  const codex = provider('codex', 'Codex', [
    { id: 'gpt-5.6-sol', totalTokens: 800 }, { id: 'claude-opus', totalTokens: 200 },
  ], { price: 200, renewal: { configured: true, daysRemaining: 7 } });
  const cursor = provider('cursor', 'Cursor', [
    { id: 'gpt-5.5', totalTokens: 700 }, { id: 'gemini-3', totalTokens: 300 },
  ], { price: 20 });
  const kimi = provider('kimi-code', 'Kimi Code', [{ id: 'kimi-k3', totalTokens: 500 }]);
  const unused = provider('warp', 'Warp', [], { price: 15 });
  const review = buildPortfolioReview([codex, cursor, kimi, unused], NOW);
  assert.equal(review.overlaps.length, 1);
  assert.equal(review.overlaps[0].leftLabel, 'Codex');
  assert.equal(review.overlaps[0].rightLabel, 'Cursor');
  assert.equal(review.overlaps[0].families[0].label, 'OpenAI');
  assert.equal(review.upcomingRenewals[0].id, 'codex');
  assert.equal(review.paidWithoutLocalUsage[0].id, 'warp');
});
