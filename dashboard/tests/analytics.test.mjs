import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, availableModels } from '../src/analytics.js';

function bucket(id, source, model, bucketStart, total) {
  return {
    id, source, model, bucketStart, inputTokens: total, cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
    totalTokens: total, requestCount: 1, costMicros: total * 10,
    pricedTokens: total, unpricedTokens: 0, assumedTokens: 0,
  };
}

const data = {
  generatedAt: '2026-08-11T12:00:00.000Z',
  buckets: [
    bucket(1, 'kimi-code', 'kimi-k3', '2026-08-10T12:00:00.000Z', 300),
    bucket(2, 'codex', 'gpt-5.6-sol', '2026-08-01T12:00:00.000Z', 200),
    bucket(3, 'kimi-code', 'kimi-k3-256k', '2026-07-01T12:00:00.000Z', 100),
  ],
  sessions: [{ source: 'kimi-code', lastMessageAt: '2026-08-10T12:00:00.000Z' }],
  activityHours: [
    { source: 'kimi-code', hourStart: '2026-08-10T12:00:00.000Z', activeSeconds: 120, engagedSeconds: 180, messageCount: 5, userMessageCount: 2 },
    { source: 'codex', hourStart: '2026-08-01T12:00:00.000Z', activeSeconds: 60, engagedSeconds: 70, messageCount: 3, userMessageCount: 1 },
  ],
};

test('analysis separates selected range, equal previous window, and lifetime totals', () => {
  const report = analyze(data, { range: '7d', source: 'all', model: 'all' });
  assert.equal(report.totals.totalTokens, 300);
  assert.equal(report.previous.totals.totalTokens, 200);
  assert.equal(report.lifetimeTotals.totalTokens, 600);
  assert.equal(report.activeSeconds, 120);
  assert.equal(report.previous.activeSeconds, 60);
  assert.equal(report.peakTokens, 300);
});

test('model identity and source filters stay precise', () => {
  assert.deepEqual(availableModels(data, 'kimi-code'), ['kimi-k3', 'kimi-k3-256k']);
  const report = analyze(data, { range: 'all', source: 'kimi-code', model: 'kimi-k3-256k' });
  assert.equal(report.totals.totalTokens, 100);
  assert.equal(report.topModel, 'kimi-k3-256k');
  assert.equal(report.toolCount, 1);
});
