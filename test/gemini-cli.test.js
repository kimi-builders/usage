import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// KBU_USAGE_GEMINI_DIR points at isolated fixtures before import so the
// developer's real ~/.gemini/tmp can never leak in. Each test re-points the
// override at its own dir (roots resolve lazily).
const root = mkdtempSync(join(tmpdir(), 'kbu-gemini-test-'));
process.env.KBU_USAGE_GEMINI_DIR = join(root, 'placeholder');

const { parse, roots } = await import('../src/parsers/gemini-cli.js');

const SALT = 'test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

function useDir(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  process.env.KBU_USAGE_GEMINI_DIR = dir;
  return dir;
}

function writeChat(dir, projectHash, relPath, records) {
  const file = join(dir, projectHash, 'chats', relPath);
  mkdirSync(dirname(file), { recursive: true });
  if (relPath.endsWith('.jsonl')) {
    writeFileSync(file, `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`, 'utf8');
  } else {
    writeFileSync(file, JSON.stringify(records), 'utf8');
  }
}

function sumTokens(result) {
  const sum = (key) => result.buckets.reduce((total, bucket) => total + bucket[key], 0);
  return {
    input: sum('inputTokens'),
    cacheWrite: sum('cacheWriteInputTokens'),
    cacheRead: sum('cacheReadInputTokens'),
    output: sum('outputTokens'),
    reasoning: sum('reasoningOutputTokens'),
    requests: result.buckets.reduce((total, bucket) => total + bucket.requestCount, 0),
  };
}

test('missing tmp dir reports not installed (null)', async () => {
  process.env.KBU_USAGE_GEMINI_DIR = join(root, 'absent');
  assert.deepEqual(roots(), []);
  assert.equal(await parse({ sessionSalt: SALT }), null);
});

test('jsonl: tokens split to exclusive fields (cached out of input, thoughts out of output)', async () => {
  const dir = useDir('basic');
  writeChat(dir, 'abc123', 'session-2026-08-01T10-00-x1.jsonl', [
    { sessionId: 'x1', directories: ['/work/demo-app'] },
    { type: 'user', timestamp: '2026-08-01T10:01:00.000Z' },
    {
      type: 'gemini',
      timestamp: '2026-08-01T10:02:00.000Z',
      model: 'gemini-2.5-pro',
      tokens: { input: 1000, output: 110, cached: 300, thoughts: 60 },
    },
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 700, cacheWrite: 0, cacheRead: 300, output: 50, reasoning: 60, requests: 1,
  });
  assert.equal(result.buckets[0].project, 'demo-app');
  assert.equal(result.buckets[0].model, 'gemini-2.5-pro');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].userMessageCount, 1);
});

test('legacy usageMetadata records and .json session files are read', async () => {
  const dir = useDir('legacy');
  writeChat(dir, 'def456', 'session-2026-07-31T09-00-y1.json', {
    directories: ['/work/legacy-app'],
    messages: [
      { role: 'user', timestamp: '2026-07-31T09:01:00.000Z' },
      {
        role: 'model',
        timestamp: '2026-07-31T09:02:00.000Z',
        model: 'gemini-2.5-flash',
        usageMetadata: {
          promptTokenCount: 500,
          candidatesTokenCount: 80,
          cachedContentTokenCount: 100,
          thoughtsTokenCount: 20,
        },
      },
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 400, cacheWrite: 0, cacheRead: 100, output: 60, reasoning: 20, requests: 1,
  });
  assert.equal(result.buckets[0].project, 'legacy-app');
});

test('nested subagent sessions are collected; noise records are skipped', async () => {
  const dir = useDir('nested');
  writeChat(dir, 'abc123', 'session-parent.jsonl', [
    { directories: ['/work/demo-app'] },
    { type: 'user', timestamp: '2026-08-01T10:01:00.000Z' },
    { type: 'gemini', timestamp: '2026-08-01T10:02:00.000Z', model: 'gemini-2.5-pro', tokens: { input: 10, output: 5 } },
  ]);
  writeChat(dir, 'abc123', 'parent-sub/sub-agent.jsonl', [
    { directories: ['/work/demo-app'] },
    { type: 'gemini', timestamp: '2026-08-01T10:03:00.000Z', model: 'gemini-2.5-pro', tokens: { input: 20, output: 6 } },
  ]);
  writeChat(dir, 'abc123', 'session-noise.jsonl', [
    'not json at all',
    { type: 'info', timestamp: '2026-08-01T10:04:00.000Z', content: 'system noise' },
    { type: 'gemini', timestamp: 'broken', model: 'gemini-2.5-pro', tokens: { input: 999, output: 9 } },
    { type: 'gemini', timestamp: '2026-08-01T10:05:00.000Z', model: 'gemini-2.5-pro', tokens: { input: 0, output: 0 } },
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 30, cacheWrite: 0, cacheRead: 0, output: 11, reasoning: 0, requests: 2,
  });
  // parent + subagent + noise files are separate sessions (the zero-usage
  // turn in the noise file still counts as activity, just no tokens).
  assert.equal(result.sessions.length, 3);
});
