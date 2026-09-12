import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSyncFailure, buildSyncOutcome, describeSyncProgress, formatSyncDuration, syncScopeState } from '../src/sync-feedback.js';

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

test('sync scope summary counts saved permissions, not unsaved drafts or unknown agents', () => {
  const sources = [{ id: 'codex', mode: 'private' }, { id: 'qoder', mode: 'local' }, { id: 'dsh', mode: 'off' }];
  assert.deepEqual(syncScopeState(sources, { codex: 'private', qoder: 'local', dsh: 'off' }), { syncCount: 1, dirty: false });
  assert.deepEqual(syncScopeState(sources, { codex: 'off', qoder: 'private', dsh: 'private', unknown: 'private' }), { syncCount: 1, dirty: true });
  assert.deepEqual(syncScopeState([], {}), { syncCount: 0, dirty: false });
});

test('progress labels separate scanning, retry waits, and measured upload ETA in both languages', () => {
  assert.match(buildSyncFailure({ lastErrorCode: 'authentication_failed' }, true).text, /授权已失效/);
  assert.match(buildSyncFailure({}, false).text, /private local run log/);
  assert.equal(describeSyncProgress({ phase: 'scanning' }, true), '正在扫描本机来源');
  assert.equal(describeSyncProgress({ phase: 'scanning' }, false), 'Scanning local sources');
  assert.match(describeSyncProgress({ phase: 'retrying', totalBatches: 4, completedBatches: 1, retryDelayMs: 2000 }, true), /1\/4 批 · 2 秒后重试/);
  assert.match(describeSyncProgress({ phase: 'uploading', totalBatches: 4, completedBatches: 1, remainingMs: 9000 }, false), /1\/4 batches acknowledged · About 9s remaining/);
  assert.match(buildSyncOutcome({ compressedBytes: 2048 }, true).details, /2.0 KB（不含重试）/);
});
