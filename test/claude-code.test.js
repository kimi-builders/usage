import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// The parser resolves roots lazily via KBU_USAGE_CLAUDE_DIRS, but set the
// override before import anyway (collector convention) so the developer's
// real ~/.claude can never leak in. Each test re-points the override at its
// own isolated dir.
const root = mkdtempSync(join(tmpdir(), 'kbu-claude-test-'));
const rootA = join(root, 'claude-a');
const rootB = join(root, 'claude-b');
mkdirSync(rootA, { recursive: true });
mkdirSync(rootB, { recursive: true });
process.env.KBU_USAGE_CLAUDE_DIRS = [rootA, rootB].join(delimiter);

const { parse, roots } = await import('../src/parsers/claude-code.js');

const SALT = 'test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

function useDir(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  process.env.KBU_USAGE_CLAUDE_DIRS = dir;
  return dir;
}

function writeSession(base, projectDir, sessionId, records) {
  const dir = join(base, 'projects', projectDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`, 'utf8');
  return file;
}

function assistant(ts, usage, extra = {}) {
  return {
    type: 'assistant',
    timestamp: ts,
    cwd: '/Users/x/demo-app',
    uuid: extra.uuid,
    message: { model: extra.model ?? 'claude-opus-4', usage },
    ...(extra.isSidechain ? { isSidechain: true } : {}),
  };
}

function usage(values) {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...values,
  };
}

function sumTokens(result) {
  const sum = (key) => result.buckets.reduce((total, bucket) => total + bucket[key], 0);
  return {
    input: sum('inputTokens'),
    cacheWrite: sum('cacheWriteInputTokens'),
    cacheRead: sum('cacheReadInputTokens'),
    output: sum('outputTokens'),
    requests: result.buckets.reduce((total, bucket) => total + bucket.requestCount, 0),
  };
}

test('roots() resolves exactly the override dirs', () => {
  assert.deepEqual(roots(), [rootA, rootB]);
});

test('token mapping: exclusive fields, cache write = max(total, 5m+1h)', async () => {
  const dir = useDir('mapping');
  writeSession(dir, '-Users-x-demo-app', 'mapping', [
    // cache_creation total wins over the (smaller) 5m+1h breakdown
    assistant('2026-08-01T10:02:00.000Z', usage({
      input_tokens: 200,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 80,
      cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 40 },
    }), { uuid: 'm1' }),
    // breakdown wins when it exceeds the (stale) total
    assistant('2026-08-01T10:03:00.000Z', usage({
      input_tokens: 100,
      output_tokens: 10,
      cache_creation_input_tokens: 10,
      cache_creation: { ephemeral_5m_input_tokens: 15, ephemeral_1h_input_tokens: 25 },
    }), { uuid: 'm2' }),
    // only the breakdown present
    assistant('2026-08-01T10:04:00.000Z', {
      input_tokens: 5,
      output_tokens: 1,
      cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 4 },
    }, { uuid: 'm3' }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 305,
    cacheWrite: 80 + 40 + 7,
    cacheRead: 50,
    output: 31,
    requests: 3,
  });
  assert.equal(result.buckets[0].reasoningOutputTokens, 0);
});

test('uuid dedup across files keeps the payload with the highest usage sum', async () => {
  const dir = useDir('uuid-dedup');
  writeSession(dir, '-Users-x-demo-app', 'copy-a', [
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 10, output_tokens: 1 }), { uuid: 'dup-1' }),
  ]);
  // Same uuid reappears in a differently-named copy with a larger payload.
  writeSession(dir, '-Users-x-other', 'copy-b', [
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 99, output_tokens: 9 }), { uuid: 'dup-1' }),
    // Entries without a uuid are always kept.
    { type: 'assistant', timestamp: '2026-08-01T10:03:00.000Z', cwd: '/Users/x/other', message: { model: 'claude-opus-4', usage: usage({ input_tokens: 7, output_tokens: 2 }) } },
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), { input: 106, cacheWrite: 0, cacheRead: 0, output: 11, requests: 2 });
});

test('physical copies of one session id keep the largest file only', async () => {
  const small = [
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 1, output_tokens: 1 }), { uuid: 's1' }),
  ];
  const large = [
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 100, output_tokens: 10 }), { uuid: 'l1' }),
    assistant('2026-08-01T10:03:00.000Z', usage({ input_tokens: 200, output_tokens: 20 }), { uuid: 'l2' }),
  ];
  writeSession(rootA, '-Users-x-demo-app', 'shared-id', small);
  writeSession(rootB, '-Users-x-demo-app', 'shared-id', large);
  process.env.KBU_USAGE_CLAUDE_DIRS = [rootA, rootB].join(delimiter);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), { input: 300, cacheWrite: 0, cacheRead: 0, output: 30, requests: 2 });
});

test("'<synthetic>' and empty models carry forward the last real model", async () => {
  const dir = useDir('models');
  writeSession(dir, '-Users-x-demo-app', 'models', [
    assistant('2026-08-01T10:01:00.000Z', usage({ input_tokens: 1, output_tokens: 1 }), { model: '<synthetic>', uuid: 'x1' }),
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 2, output_tokens: 1 }), { model: 'claude-sonnet-4', uuid: 'x2' }),
    assistant('2026-08-01T10:03:00.000Z', usage({ input_tokens: 4, output_tokens: 1 }), { model: '<synthetic>', uuid: 'x3' }),
    assistant('2026-08-01T10:04:00.000Z', usage({ input_tokens: 8, output_tokens: 1 }), { model: '', uuid: 'x4' }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  const byModel = Object.fromEntries(result.buckets.map((bucket) => [bucket.model, bucket.inputTokens]));
  assert.deepEqual(byModel, { unknown: 1, 'claude-sonnet-4': 14 });
});

test('project comes from the first cwd, else the hyphen-joined dir name', async () => {
  const dir = useDir('project');
  writeSession(dir, '-Users-x-demo-app', 'with-cwd', [
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 1, output_tokens: 1 }), { uuid: 'p1' }),
  ]);
  const noCwd = assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 2, output_tokens: 1 }), { uuid: 'p2' });
  delete noCwd.cwd;
  writeSession(dir, '-Users-bar-some-service', 'no-cwd', [noCwd]);
  const result = await parse({ sessionSalt: SALT });
  const projects = result.buckets.map((bucket) => bucket.project).sort();
  assert.deepEqual(projects, ['demo-app', 'service']);
});

test('corrupt lines, invalid timestamps, and zero-usage records are skipped', async () => {
  const dir = useDir('messy');
  writeSession(dir, '-Users-x-demo-app', 'messy', [
    'this is not json',
    assistant('not-a-timestamp', usage({ input_tokens: 999, output_tokens: 999 }), { uuid: 'bad-ts' }),
    assistant('2026-08-01T10:02:00.000Z', usage({}), { uuid: 'zeros' }),
    assistant('2026-08-01T10:03:00.000Z', usage({ input_tokens: -5, output_tokens: 3 }), { uuid: 'neg' }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), { input: 0, cacheWrite: 0, cacheRead: 0, output: 3, requests: 1 });
});

test('sub-agent sidechain records are counted normally', async () => {
  const dir = useDir('sidechain');
  writeSession(dir, '-Users-x-demo-app', 'sidechain', [
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 10, output_tokens: 2 }), { uuid: 'main' }),
    assistant('2026-08-01T10:03:00.000Z', usage({ input_tokens: 20, output_tokens: 4 }), { uuid: 'side', isSidechain: true }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), { input: 30, cacheWrite: 0, cacheRead: 0, output: 6, requests: 2 });
});

test('session events feed the shared extractor (user vs assistant roles)', async () => {
  const dir = useDir('timing');
  writeSession(dir, '-Users-x-demo-app', 'timing', [
    { type: 'user', timestamp: '2026-08-01T10:01:00.000Z', cwd: '/Users/x/demo-app', message: {} },
    assistant('2026-08-01T10:02:00.000Z', usage({ input_tokens: 1, output_tokens: 1 }), { uuid: 't1' }),
    { type: 'tool_use', timestamp: '2026-08-01T10:03:00.000Z', cwd: '/Users/x/demo-app' },
    assistant('2026-08-01T10:04:00.000Z', usage({ input_tokens: 1, output_tokens: 1 }), { uuid: 't2' }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].source, 'claude-code');
  assert.equal(result.sessions[0].messageCount, 4);
  assert.equal(result.sessions[0].userMessageCount, 1);
  assert.equal(result.sessions[0].activeSeconds, 120); // first response 10:02 → last 10:04
});
