import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Isolated fixtures for both stores, set before the module is imported.
const root = mkdtempSync(join(tmpdir(), 'vibe-usage-kimi-legacy-test-'));
const currentRoot = join(root, 'kimi-code');
const legacyRoot = join(root, 'kimi-legacy');
process.env.KBU_USAGE_KIMI_CODE_DIR = currentRoot;
process.env.KBU_USAGE_KIMI_DIR = legacyRoot;

const { parse } = await import('../src/parsers/kimi-code.js');

after(() => rmSync(root, { recursive: true, force: true }));

const LEGACY_WORKDIR = '/workspace/legacy-project';
const LEGACY_WORKDIR_HASH = createHash('md5').update(LEGACY_WORKDIR).digest('hex');

function legacyWire(dir, lines) {
  const sessionDir = join(legacyRoot, 'sessions', LEGACY_WORKDIR_HASH, dir);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'wire.jsonl'), `${lines.map(JSON.stringify).join('\n')}\n`, 'utf-8');
}

function statusUpdate(timestamp, tokenUsage, messageId) {
  return {
    timestamp,
    message: {
      type: 'StatusUpdate',
      payload: { token_usage: tokenUsage, ...(messageId ? { message_id: messageId } : {}) },
    },
  };
}

test('legacy parser: seconds timestamps, cache fields, no now-fallback, both stores merged', async () => {
  mkdirSync(legacyRoot, { recursive: true });
  writeFileSync(join(legacyRoot, 'kimi.json'), JSON.stringify({ work_dirs: [{ path: LEGACY_WORKDIR }] }), 'utf-8');
  writeFileSync(join(legacyRoot, 'config.toml'), 'default_model = "kimi-code/kimi-for-coding"\n', 'utf-8');

  const t = Date.parse('2026-04-29T10:05:00.000Z') / 1000; // legacy timestamps are float seconds
  legacyWire('session-aaa', [
    // Before any timestamp has been seen in the file → skipped, never
    // stamped "now" (a "now" fallback re-keys into a fresh bucket each sync).
    { message: { type: 'StatusUpdate', payload: { token_usage: { input_other: 999, output: 999 } } } },
    { timestamp: t, message: { type: 'UserMessage', payload: { text: 'hi' } } },
    statusUpdate(t + 60, { input_other: 10, output: 2, input_cache_read: 4, input_cache_creation: 3 }, 'm1'),
    // Cache-read-only records are real billed usage, not noise.
    statusUpdate(t + 120, { input_other: 0, output: 0, input_cache_read: 6 }, 'm2'),
    // Duplicate message_id must be counted once.
    statusUpdate(t + 121, { input_other: 0, output: 0, input_cache_read: 6 }, 'm2'),
  ]);

  // A current-format session coexists: both stores must be parsed and merged.
  const start = Date.parse('2026-07-17T00:01:00.000Z');
  const mainDir = join(currentRoot, 'sessions', 'wd_newproj_abcd', 'session_123', 'agents', 'main');
  mkdirSync(mainDir, { recursive: true });
  writeFileSync(join(mainDir, 'wire.jsonl'), `${[
    { type: 'turn.prompt', origin: { kind: 'user' }, time: start },
    {
      type: 'usage.record',
      model: 'kimi-code/k3',
      usage: { inputOther: 7, output: 1, inputCacheRead: 0, inputCacheCreation: 0 },
      usageScope: 'turn',
      time: start + 60_000,
    },
  ].map(JSON.stringify).join('\n')}\n`, 'utf-8');

  const result = await parse({ sessionSalt: 'test-session-salt'.padEnd(32, 'x') });
  assert.equal(result.buckets.length, 2);

  const legacyBucket = result.buckets.find((b) => b.project === 'legacy-project');
  assert.deepEqual(legacyBucket, {
    source: 'kimi-code',
    model: 'kimi-code/kimi-for-coding',
    project: 'legacy-project',
    bucketStart: '2026-04-29T10:00:00.000Z',
    inputTokens: 10,
    cacheWriteInputTokens: 3,
    cacheReadInputTokens: 10, // 4 + 6 (dedup by message_id), cache-only record counted
    outputTokens: 2,
    reasoningOutputTokens: 0,
    requestCount: 2,
    measurement: 'exact',
  });

  const currentBucket = result.buckets.find((b) => b.project === 'newproj');
  assert.equal(currentBucket.inputTokens, 7);

  // Sessions from both stores are present.
  const legacySession = result.sessions.find((s) => s.project === 'legacy-project');
  assert.equal(legacySession.userMessageCount, 1);
  assert.equal(legacySession.firstMessageAt, '2026-04-29T10:05:00.000Z');
  assert.ok(result.sessions.some((s) => s.project === 'newproj'));
});
