import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBucketsCsv, formatSessionsCsv, validateExportOptions } from '../src/export.js';

test('formatBucketsCsv formats CSV lines correctly with headers and commas', () => {
  const buckets = [
    {
      source: 'claude-code',
      model: 'claude-3-7-sonnet, beta',
      modelCanonical: 'claude-3-7-sonnet',
      modelProvider: 'anthropic',
      bucketStart: '2026-08-19T00:00:00.000Z',
      inputTokens: 1000,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: 200,
      outputTokens: 500,
      reasoningOutputTokens: 50,
      totalTokens: 1750,
      costMicros: 25000, // $0.0250
      requestCount: 5,
      project: 'my-project',
    },
  ];

  const csv = formatBucketsCsv(buckets);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^source,model,model_canonical/);
  // Must escape commas in model name
  assert.match(lines[1], /"claude-3-7-sonnet, beta"/);
  assert.match(lines[1], /0.0250/);
});

test('formatSessionsCsv formats session rows', () => {
  const sessions = [
    {
      source: 'kimi-code',
      project: 'kimi-brand',
      firstMessageAt: '2026-08-19T00:00:00.000Z',
      lastMessageAt: '2026-08-19T01:00:00.000Z',
      durationSeconds: 3600,
      activeSeconds: 1800,
      messageCount: 20,
      userMessageCount: 10,
    },
  ];

  const csv = formatSessionsCsv(sessions);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^source,project,first_message_at/);
  assert.match(lines[1], /kimi-code,kimi-brand,2026-08-19/);
});

test('CSV exports neutralize spreadsheet formulas in every text field', () => {
  const csv = formatSessionsCsv([{
    source: '=HYPERLINK("https://example.test")',
    project: '+SUM(1,1)',
    firstMessageAt: '-1+1',
    lastMessageAt: '@cmd',
  }]);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)"/);
  assert.match(csv, /"'\+SUM\(1,1\)"/);
  assert.match(csv, /'-1\+1/);
  assert.match(csv, /'@cmd/);
});

test('bucket CSV distinguishes unpriced, partial, and priced estimates', () => {
  const base = {
    source: 'codex', model: 'private-model', bucketStart: '2026-08-19T00:00:00.000Z',
    totalTokens: 100, inputTokens: 100, requestCount: 1,
  };
  const csv = formatBucketsCsv([
    { ...base, status: 'unpriced', costMicros: 0, pricedTokens: 0, unpricedTokens: 100 },
    { ...base, model: 'partial-model', status: 'partial', costMicros: 50_000, pricedTokens: 50, unpricedTokens: 50 },
  ]);
  const [header, unpriced, partial] = csv.split('\n');
  assert.match(header, /cost_usd,pricing_status,priced_tokens,unpriced_tokens,assumed_tokens,price_version/);
  assert.match(unpriced, /,100,,unpriced,0,100,0,,1,/);
  assert.match(partial, /,100,0\.0500,partial,50,50,0,,1,/);
});

test('export option validation rejects silent format and type fallbacks', () => {
  assert.deepEqual(validateExportOptions('JSON', 'all'), { format: 'json', type: 'all' });
  assert.throws(() => validateExportOptions('xlsx', 'buckets'), /Unsupported export format/);
  assert.throws(() => validateExportOptions('csv', 'summary'), /does not support type/);
  assert.throws(() => validateExportOptions('jsonl', 'all'), /does not support type/);
});
