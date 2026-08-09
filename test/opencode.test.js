import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// KBU_USAGE_OPENCODE_DIR points at isolated fixtures before import so the
// developer's real ~/.local/share/opencode can never leak in. Each test
// re-points the override at its own dir (roots resolve lazily).
const root = mkdtempSync(join(tmpdir(), 'kbu-opencode-test-'));
process.env.KBU_USAGE_OPENCODE_DIR = join(root, 'placeholder');

const { parse, roots } = await import('../src/parsers/opencode.js');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // node:sqlite unavailable (Node < 22.5) — SQLite tests skip, JSON tests run.
}

const SALT = 'test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

function useDir(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  process.env.KBU_USAGE_OPENCODE_DIR = dir;
  return dir;
}

function buildDb(dir, rows) {
  const db = new DatabaseSync(join(dir, 'opencode.db'));
  try {
    db.exec('CREATE TABLE message (session_id TEXT, data TEXT)');
    const insert = db.prepare('INSERT INTO message (session_id, data) VALUES (?, ?)');
    for (const row of rows) insert.run(row.sessionId, JSON.stringify(row.data));
  } finally {
    db.close();
  }
}

function message(role, created, extra = {}) {
  return {
    role,
    time: { created },
    modelID: 'kimi-k2',
    path: { root: '/work/demo-app' },
    ...extra,
  };
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

test('missing data dir reports not installed (null)', async () => {
  process.env.KBU_USAGE_OPENCODE_DIR = join(root, 'absent');
  assert.deepEqual(roots(), []);
  assert.equal(await parse({ sessionSalt: SALT }), null);
});

test('sqlite path: exclusive token mapping incl. cache write/read + reasoning', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite');
  buildDb(dir, [
    { sessionId: 'ses_1', data: message('user', Date.parse('2026-08-01T10:01:00.000Z'), { modelID: undefined }) },
    {
      sessionId: 'ses_1',
      data: message('assistant', Date.parse('2026-08-01T10:02:00.000Z'), {
        modelID: 'kimi-k2-thinking',
        providerID: 'moonshot',
        variant: 'high',
        tokens: { input: 100, output: 40, reasoning: 10, cache: { read: 30, write: 20 } },
      }),
    },
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 100, cacheWrite: 20, cacheRead: 30, output: 40, reasoning: 10, requests: 1,
  });
  assert.equal(result.buckets[0].model, 'kimi-k2-thinking');
  assert.equal(result.buckets[0].modelProvider, 'moonshot');
  assert.equal(result.buckets[0].reasoningEffort, 'high');
  assert.equal(result.buckets[0].project, 'demo-app');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].userMessageCount, 1);
  assert.equal(result.sessions[0].messageCount, 2);
});

test('sqlite path: corrupt tokens, missing model, bad timestamps are skipped', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite-messy');
  buildDb(dir, [
    // tokens is a plain string — JSON.parse fails in the parser, row skipped
    { sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:01:00.000Z'), { tokens: 'garbage' }) },
    // no modelID → session event only, no usage entry
    { sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:02:00.000Z'), { modelID: undefined, tokens: { input: 999, output: 9 } }) },
    // invalid timestamp → row skipped entirely
    { sessionId: 'ses_1', data: message('assistant', 'not-a-time', { tokens: { input: 999, output: 9 } }) },
    // zero usage → dropped
    { sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:03:00.000Z'), { tokens: { input: 0, output: 0 } }) },
    { sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:04:00.000Z'), { tokens: { input: 10, output: 5 } }) },
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 10, cacheWrite: 0, cacheRead: 0, output: 5, reasoning: 0, requests: 1,
  });
  // Session events: every row with a valid timestamp (token gating aside).
  assert.equal(result.sessions[0].messageCount, 4);
});

test('legacy JSON store is parsed when no db exists', async () => {
  const dir = useDir('legacy');
  const sessionDir = join(dir, 'storage', 'message', 'ses_abc');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'msg_1.json'), JSON.stringify(
    message('user', Date.parse('2026-08-01T10:01:00.000Z'), { modelID: undefined }),
  ), 'utf8');
  writeFileSync(join(sessionDir, 'msg_2.json'), JSON.stringify(
    message('assistant', Date.parse('2026-08-01T10:02:00.000Z'), {
      tokens: { input: 50, output: 20, reasoning: 5, cache: { read: 10, write: 4 } },
    }),
  ), 'utf8');
  writeFileSync(join(sessionDir, 'broken.json'), '{not json', 'utf8');
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 50, cacheWrite: 4, cacheRead: 10, output: 20, reasoning: 5, requests: 1,
  });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].project, 'demo-app');
});

test('a readable db wins over the legacy store (no double counting)', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('both');
  buildDb(dir, [
    { sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:02:00.000Z'), { tokens: { input: 7, output: 3 } }) },
  ]);
  const sessionDir = join(dir, 'storage', 'message', 'ses_1');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'msg_1.json'), JSON.stringify(
    message('assistant', Date.parse('2026-08-01T10:02:00.000Z'), { tokens: { input: 1000, output: 1000 } }),
  ), 'utf8');
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 7, cacheWrite: 0, cacheRead: 0, output: 3, reasoning: 0, requests: 1,
  });
});
