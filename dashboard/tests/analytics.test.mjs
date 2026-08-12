import assert from 'node:assert/strict';
import test from 'node:test';
import { analyze, availableModels, buildRecords, filterOptions, heatmapView } from '../src/analytics.js';
import { distributionShare, pluralUnit, usdMoney } from '../src/format.js';

function bucket(id, source, model, bucketStart, total) {
  return {
    id, source, model, bucketStart, inputTokens: total, cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0,
    totalTokens: total, requestCount: 1, costMicros: total * 10,
    pricedTokens: total, unpricedTokens: 0, assumedTokens: 0,
    modelCanonical: model, reasoningEffort: source === 'codex' ? 'high' : null,
    agentVersion: source === 'codex' ? '0.147.0' : '1.44.0', project: source === 'codex' ? 'site' : 'cli',
  };
}

const data = {
  generatedAt: '2026-08-11T12:00:00.000Z',
  device: { terminal: { name: 'Warp' }, os: { name: 'macOS' } },
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

test('English count units use the singular only for exactly one item', () => {
  assert.equal(pluralUnit(1, 'item'), 'item');
  assert.equal(pluralUnit(0, 'item'), 'items');
  assert.equal(pluralUnit(2, 'request'), 'requests');
});

test('analysis separates selected range, equal previous window, and lifetime totals', () => {
  const report = analyze(data, { range: '7d', source: 'all', model: 'all' });
  assert.equal(report.totals.totalTokens, 300);
  assert.equal(report.previous.totals.totalTokens, 200);
  assert.equal(report.lifetimeTotals.totalTokens, 600);
  assert.equal(report.activeSeconds, 120);
  assert.equal(report.previous.activeSeconds, 60);
  assert.equal(report.peakTokens, 300);
});

test('24H uses exactly 24 hourly slots with unambiguous date and hour labels', () => {
  const report = analyze(data, { range: '24h' });
  const expectedLabel = (value) => `${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:00`;
  const last = new Date(data.generatedAt);
  last.setMinutes(0, 0, 0);
  const first = new Date(last);
  first.setHours(first.getHours() - 23);
  assert.equal(report.seriesUnit, 'hour');
  assert.equal(report.series.length, 24);
  assert.equal(report.series[0].label, expectedLabel(first));
  assert.equal(report.series.at(-1).label, expectedLabel(last));
});

test('model identity and source filters stay precise', () => {
  assert.deepEqual(availableModels(data, 'kimi-code'), ['kimi-k3', 'kimi-k3-256k']);
  const report = analyze(data, { range: 'all', source: 'kimi-code', model: 'kimi-k3-256k' });
  assert.equal(report.totals.totalTokens, 100);
  assert.equal(report.topModel, 'kimi-k3-256k');
  assert.equal(report.toolCount, 1);
});

test('multi-dimension filters use AND across dimensions and OR within one dimension', () => {
  const report = analyze(data, {
    range: 'all',
    sources: ['kimi-code', 'codex'],
    models: ['kimi-k3', 'gpt-5.6-sol'],
    efforts: ['high'],
    agentVersions: ['0.147.0'],
    projects: ['site'],
    devices: ['Warp · macOS'],
  });
  assert.equal(report.totals.totalTokens, 200);
  assert.equal(report.sourceRows[0].id, 'codex');
  assert.equal(report.recordsByDay.length, 1);
});

test('heatmap keeps detailed token, cost, time, and prompt facts in the same cell', () => {
  const report = analyze(data, { range: 'all' });
  const instant = new Date('2026-08-10T12:00:00.000Z');
  const localCell = report.heatmap.cells[(instant.getDay() + 6) % 7][instant.getHours()];
  assert.equal(localCell.totalTokens, 300);
  assert.equal(localCell.activeSeconds, 120);
  assert.equal(localCell.userMessageCount, 2);
  assert.equal(localCell.costMicros, 3_000);
  assert.equal(localCell.observed, true);
  assert.equal(report.heatmap.cells[(instant.getDay() + 6) % 7][(instant.getHours() + 1) % 24].observed, false);
  assert.equal(heatmapView(report.heatmap, 'prompts').slots[0].value, 2);
  assert.equal(heatmapView(report.heatmap, 'prompts').peak.cell, localCell);
});

test('records switch between 30-minute facts and daily grouped rows', () => {
  const duplicate = { ...data.buckets[0], id: 4, bucketStart: '2026-08-10T12:30:00.000Z', totalTokens: 50, inputTokens: 50 };
  const rows = [data.buckets[0], duplicate];
  assert.equal(buildRecords(rows, 'bucket').length, 2);
  const daily = buildRecords(rows, 'day');
  assert.equal(daily.length, 1);
  assert.equal(daily[0].totalTokens, 350);
  assert.equal(daily[0].requestCount, 2);
});

test('filter options preserve private/unknown dimensions as explicit empty values', () => {
  const options = filterOptions({ ...data, buckets: [...data.buckets, { ...data.buckets[0], id: 9, project: null, reasoningEffort: null }] });
  assert.deepEqual(options.devices, ['Warp · macOS']);
  assert.ok(options.projects.includes(''));
  assert.ok(options.efforts.includes(''));
  assert.deepEqual(options.sources.slice(0, 2), ['kimi-code', 'codex']);
});

test('API-equivalent micros stay explicitly denominated in USD', () => {
  assert.equal(usdMoney(7_200_000), 'USD 7.20');
  assert.equal(usdMoney(1_000), 'USD 0.0010');
});

test('distribution shares use every row, including rows below the top six', () => {
  const rows = [60, 20, 10, 5, 3, 1, 1].map((totalTokens) => ({
    totalTokens,
    costMicros: totalTokens * 10,
  }));
  assert.equal(distributionShare(rows, rows[0], 'tokens'), 0.6);
  assert.equal(distributionShare(rows, rows[0], 'cost'), 0.6);
  assert.equal(distributionShare(rows, rows[6], 'tokens'), 0.01);
});
