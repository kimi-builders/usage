import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyncOutcome, formatSyncDuration } from '../src/sync-feedback.js';

test('sync outcome distinguishes success, no-change, partial, and rejected records', () => {
  const success = buildSyncOutcome({
    buckets: 12, sessions: 2,
    sources: [{ source: 'codex', status: 'ok' }, { source: 'kimi-code', status: 'ok' }],
  }, true);
  assert.equal(success.tone, 'success');
  assert.equal(success.title, '同步成功');
  assert.match(success.text, /12 个 buckets、2 个 sessions/);
  assert.match(success.details, /检查 2 个 Agent/);

  const unchanged = buildSyncOutcome({ sources: [{ source: 'codex', status: 'ok' }] }, false);
  assert.equal(unchanged.title, 'Sync complete');
  assert.match(unchanged.text, /No new or changed usage/);

  const partial = buildSyncOutcome({
    buckets: 1,
    sources: [{ source: 'codex', status: 'ok' }, { source: 'claude-code', status: 'failed' }],
  }, true);
  assert.equal(partial.tone, 'warning');
  assert.equal(partial.title, '部分同步完成');
  assert.match(partial.text, /Claude Code/);

  const rejected = buildSyncOutcome({ rejected: 3 }, false);
  assert.equal(rejected.tone, 'warning');
  assert.match(rejected.text, /3 invalid records/);
});

test('sync duration remains readable from seconds into minutes', () => {
  assert.equal(formatSyncDuration(12_400, true), '12 秒');
  assert.equal(formatSyncDuration(72_000, false), '1m 12s');
});
