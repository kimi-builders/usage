import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBucketsCsv, formatSessionsCsv } from '../src/export.js';

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
