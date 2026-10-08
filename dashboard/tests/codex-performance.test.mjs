import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTurnPerformance } from '../src/analytics.js';

const row = extra => ({ source: 'codex', project: 'demo', model: 'gpt-5.6-sol', modelCanonical: 'gpt-5.6-sol', reasoningEffort: 'high', agentVersion: '1.0', completedAt: '2026-10-08T10:00:00Z', durationMs: 1_000, firstTokenMs: 100, outputTokens: 100, ...extra });
const data = rows => ({ generatedAt: '2026-10-08T12:00:00Z', turnPerformance: rows });

test('performance throughput is duration-weighted; TTFT reports its own sample count and median', () => {
  const result = analyzeTurnPerformance(data([row(), row({ durationMs: 9_000, outputTokens: 900, firstTokenMs: null }), row({ firstTokenMs: 300 })]), { range: 'all' });
  assert.equal(result.outputTokensPerSecond, 100);
  assert.equal(result.sampleCount, 3); assert.equal(result.firstTokenSampleCount, 2);
  assert.equal(result.medianFirstTokenMs, 200); assert.equal(result.medianDurationMs, 1_000);
  assert.equal(analyzeTurnPerformance(data([row(), row({ durationMs: 9_000, outputTokens: 100 })]), { range: 'all' }).outputTokensPerSecond, 20);
});

test('performance follows exact time/model/source/project/effort/version/device filters', () => {
  for (const filters of [{ sources: ['claude-code'] }, { models: ['other'] }, { projects: ['other'] }, { efforts: ['low'] }, { agentVersions: ['2.0'] }, { devices: ['other'] }]) {
    assert.equal(analyzeTurnPerformance(data([row()]), { range: 'all', ...filters }).sampleCount, 0);
  }
  assert.equal(analyzeTurnPerformance(data([row({ completedAt: '2026-10-07T11:59:59Z' }), row({ completedAt: '2026-10-07T12:00:00Z' }), row({ completedAt: '2026-10-08T12:00:01Z' })]), { range: '24h' }).sampleCount, 1);
  assert.equal(analyzeTurnPerformance(data([row({ modelCanonical: 'normalized', model: 'raw' })]), { range: 'all', models: ['normalized'] }).sampleCount, 1);
});

test('no timings, invalid samples and unsafe totals do not produce estimates', () => {
  const result = analyzeTurnPerformance(data([row({ durationMs: 0 }), row({ outputTokens: NaN })]), { range: 'all' });
  assert.equal(result.sampleCount, 0); assert.equal(result.medianFirstTokenMs, null); assert.equal(result.outputTokensPerSecond, null);
  assert.equal(analyzeTurnPerformance({ generatedAt: data([]).generatedAt }, {}).sampleCount, 0);
  assert.equal(analyzeTurnPerformance(data([row({ outputTokens: Number.MAX_SAFE_INTEGER }), row()]), { range: 'all' }).outputTokensPerSecond, null);
});
