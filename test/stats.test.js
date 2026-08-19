import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, renderStatsReport, runStats } from '../src/stats.js';
import { setLocale } from '../src/cli-ui.js';

function createMockDashboardData() {
  return {
    buckets: [
      {
        source: 'claude-code',
        model: 'claude-3-7-sonnet',
        modelCanonical: 'claude-3-7-sonnet',
        project: 'project-alpha',
        bucketStart: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
        inputTokens: 1000000,
        cacheWriteInputTokens: 200000,
        cacheReadInputTokens: 800000,
        outputTokens: 500000,
        reasoningOutputTokens: 100000,
        requestCount: 50,
        totalTokens: 2600000,
        costMicros: 8500000, // $8.50
        pricedTokens: 2600000,
        unpricedTokens: 0,
      },
      {
        source: 'kimi-code',
        model: 'kimi-k3',
        modelCanonical: 'kimi-k3',
        project: 'project-beta',
        bucketStart: new Date(Date.now() - 1 * 86400 * 1000).toISOString(),
        inputTokens: 2000000,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 500000,
        outputTokens: 800000,
        reasoningOutputTokens: 0,
        requestCount: 30,
        totalTokens: 3300000,
        costMicros: 3500000, // $3.50
        pricedTokens: 3300000,
        unpricedTokens: 0,
      },
      {
        source: 'codex',
        model: 'gpt-5-codex',
        modelCanonical: 'gpt-5-codex',
        project: 'project-alpha',
        bucketStart: new Date(Date.now() - 40 * 86400 * 1000).toISOString(), // 40 days ago
        inputTokens: 5000000,
        cacheWriteInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 1000000,
        reasoningOutputTokens: 0,
        requestCount: 100,
        totalTokens: 6000000,
        costMicros: 12000000,
        pricedTokens: 6000000,
        unpricedTokens: 0,
      },
    ],
    sessions: [
      {
        source: 'claude-code',
        project: 'project-alpha',
        firstMessageAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
        lastMessageAt: new Date(Date.now() - 2 * 86400 * 1000 + 3600000).toISOString(),
        activeSeconds: 3600,
        durationSeconds: 7200,
        messageCount: 20,
        userMessageCount: 10,
      },
      {
        source: 'kimi-code',
        project: 'project-beta',
        firstMessageAt: new Date(Date.now() - 1 * 86400 * 1000).toISOString(),
        lastMessageAt: new Date(Date.now() - 1 * 86400 * 1000 + 1800000).toISOString(),
        activeSeconds: 1800,
        durationSeconds: 3600,
        messageCount: 15,
        userMessageCount: 8,
      },
    ],
  };
}

test('computeStats aggregates totals, daily, models, and sources correctly for 7d', () => {
  const data = createMockDashboardData();
  const stats = computeStats(data, { period: '7d' });

  // 7d should include claude-code and kimi-code, but exclude codex (40d ago)
  assert.equal(stats.totals.bucketCount, 2);
  assert.equal(stats.totals.totalTokens, 5900000);
  assert.equal(stats.totals.cost, 12.00);
  assert.equal(stats.totals.sessionCount, 2);
  assert.equal(stats.totals.activeSeconds, 5400);

  // Models breakdown
  assert.equal(stats.models.length, 2);
  assert.equal(stats.models[0].model, 'kimi-k3');
  assert.equal(stats.models[1].model, 'claude-3-7-sonnet');

  // Sources breakdown
  assert.equal(stats.sources.length, 2);
  assert.equal(stats.sources[0].source, 'kimi-code');
  assert.equal(stats.sources[1].source, 'claude-code');

  // Projects breakdown
  assert.equal(stats.projects.length, 2);
});

test('computeStats filters by source', () => {
  const data = createMockDashboardData();
  const stats = computeStats(data, { period: 'all', source: 'claude-code' });
  assert.equal(stats.totals.bucketCount, 1);
  assert.equal(stats.totals.totalTokens, 2600000);
  assert.equal(stats.sources.length, 1);
  assert.equal(stats.sources[0].source, 'claude-code');
});

test('renderStatsReport generates clean formatted text report', () => {
  const data = createMockDashboardData();
  const stats = computeStats(data, { period: '7d' });
  
  setLocale('zh');
  const reportZh = renderStatsReport(stats);
  assert.match(reportZh, /用量概况/);
  assert.match(reportZh, /Token 总计/);
  assert.match(reportZh, /kimi-k3/);
  assert.match(reportZh, /claude-3-7-sonnet/);
  assert.match(reportZh, /project-alpha/);

  setLocale('en');
  const reportEn = renderStatsReport(stats);
  assert.match(reportEn, /Usage Analytics/);
  assert.match(reportEn, /Total Tokens/);

  setLocale(null);
});
