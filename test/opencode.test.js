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
    db.exec('CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)');
    const insert = db.prepare('INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)');
    rows.forEach((row, index) => insert.run(row.id ?? `msg_${index}`, row.sessionId, JSON.stringify(row.data)));
  } finally {
    db.close();
  }
}

// OpenCode 2.x layout: usage lives in the session_message projection, the
// project directory in the session row, and there is no legacy message table.
// IF NOT EXISTS keeps this composable with buildDb for migrated stores that
// hold both layouts. sessionTable may be null to model a projection without
// any session table.
function buildV2Db(dir, { sessionTable = 'session_v2', sessions = [], messages = [] }) {
  const db = new DatabaseSync(join(dir, 'opencode.db'));
  try {
    if (sessionTable) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${sessionTable} (id TEXT PRIMARY KEY, directory TEXT)`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS session_message (
      id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, data TEXT)`);
    if (sessionTable) {
      const insertSession = db.prepare(`INSERT INTO ${sessionTable} (id, directory) VALUES (?, ?)`);
      for (const session of sessions) insertSession.run(session.id, session.directory);
    }
    const insertMessage = db.prepare(
      'INSERT INTO session_message (id, session_id, type, time_created, data) VALUES (?, ?, ?, ?, ?)',
    );
    for (const row of messages) {
      insertMessage.run(row.id, row.sessionId, row.type, row.time ?? null, JSON.stringify(row.data));
    }
  } finally {
    db.close();
  }
}

function v2Message(id, sessionId, type, time, data = {}) {
  return { id, sessionId, type, time, data };
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

test('GPT-6.2 OpenCode requests use full prompt length before aggregation', async () => {
  const dir = join(useDir('request-context'), 'storage', 'message', 'ses_ctx');
  mkdirSync(dir, { recursive: true });
  for (const [i, input] of [2000, 2000, 2001].entries()) {
    const row = message('assistant', Date.parse('2026-11-22T10:01:00Z'), { modelID: 'gateway/gpt-6.2-sol',
      sessionID: 'ses_ctx', tokens: { input, cache: { read: 200000, write: 70000 }, output: 10 } });
    writeFileSync(join(dir, i + '.json'), JSON.stringify(row));
  }
  const { buckets } = await parse({ sessionSalt: SALT });
  assert.deepEqual(buckets.map(b => [b.contextTier, b.inputTokens, b.requestCount]).sort(),
    [['long', 2001, 1], ['short', 4000, 2]]);
});

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

test('sqlite 2.x: session_message + session_v2 store parses instead of silently zeroing', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite-v2');
  buildV2Db(dir, {
    sessions: [{ id: 'ses_v2', directory: '/work/v2-app/' }],
    messages: [
      v2Message('msg_u1', 'ses_v2', 'user', Date.parse('2026-08-01T10:01:00.000Z')),
      v2Message('msg_a1', 'ses_v2', 'assistant', Date.parse('2026-08-01T10:02:00.000Z'), {
        model: { id: 'kimi-k2-thinking', providerID: 'moonshot' },
        variant: 'high',
        tokens: { input: 100, output: 40, reasoning: 10, cache: { read: 30, write: 20 } },
      }),
      // Projection rows that are not user/assistant messages are ignored.
      v2Message('msg_idle', 'ses_v2', 'idle', Date.parse('2026-08-01T10:03:00.000Z')),
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.skipped, undefined);
  assert.deepEqual(sumTokens(result), {
    input: 100, cacheWrite: 20, cacheRead: 30, output: 40, reasoning: 10, requests: 1,
  });
  assert.equal(result.buckets[0].model, 'kimi-k2-thinking');
  assert.equal(result.buckets[0].modelProvider, 'moonshot');
  assert.equal(result.buckets[0].reasoningEffort, 'high');
  assert.equal(result.buckets[0].project, 'v2-app'); // from the session directory, slash trimmed
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].userMessageCount, 1);
  assert.equal(result.sessions[0].messageCount, 2);
});

test('sqlite 2.x: time_created fallback and the pre-rename session table name', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite-v2-plain-session');
  buildV2Db(dir, {
    sessionTable: 'session',
    sessions: [{ id: 'ses_plain', directory: '/work/plain-app' }],
    messages: [
      // No data.time.created → the row's time_created column is used.
      v2Message('msg_a1', 'ses_plain', 'assistant', Date.parse('2026-08-01T10:02:00.000Z'), {
        modelID: 'kimi-k2',
        tokens: { input: 5, output: 2 },
      }),
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 5, cacheWrite: 0, cacheRead: 0, output: 2, reasoning: 0, requests: 1,
  });
  assert.equal(result.buckets[0].model, 'kimi-k2');
  assert.equal(result.buckets[0].project, 'plain-app');
});

test('sqlite 2.x: session_message without any session table still parses (project unknown)', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite-v2-no-session');
  buildV2Db(dir, {
    sessionTable: null,
    messages: [
      v2Message('msg_a1', 'ses_lost', 'assistant', Date.parse('2026-08-01T10:02:00.000Z'), {
        modelID: 'kimi-k2',
        tokens: { input: 5, output: 2 },
      }),
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 5, cacheWrite: 0, cacheRead: 0, output: 2, reasoning: 0, requests: 1,
  });
  assert.equal(result.buckets[0].project, 'unknown');
});

test('sqlite: a message present in both layouts is counted once and keeps its legacy project', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite-mixed');
  buildDb(dir, [
    { id: 'msg_u1', sessionId: 'ses_1', data: message('user', Date.parse('2026-08-01T10:01:00.000Z'), { modelID: undefined }) },
    { id: 'msg_a1', sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:02:00.000Z'), { tokens: { input: 7, output: 3 } }) },
  ]);
  buildV2Db(dir, {
    sessions: [{ id: 'ses_1', directory: '/work/migrated-app' }],
    messages: [
      // Same message id as the legacy row: counted once, and the legacy copy
      // wins the tie so the project is not renamed to the session directory.
      v2Message('msg_a1', 'ses_1', 'assistant', Date.parse('2026-08-01T10:02:00.000Z'), {
        modelID: 'kimi-k2',
        tokens: { input: 7, output: 3 },
      }),
      // 2.x-only message: project falls back to the session directory.
      v2Message('msg_a2', 'ses_1', 'assistant', Date.parse('2026-08-01T10:03:00.000Z'), {
        modelID: 'kimi-k2',
        tokens: { input: 1000, output: 500 },
      }),
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 1007, cacheWrite: 0, cacheRead: 0, output: 503, reasoning: 0, requests: 2,
  });
  const legacy = result.buckets.find((bucket) => bucket.project === 'demo-app');
  const migrated = result.buckets.find((bucket) => bucket.project === 'migrated-app');
  assert.equal(legacy.inputTokens, 7);
  assert.equal(migrated.inputTokens, 1000);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].messageCount, 3); // msg_u1 + msg_a1 (once) + msg_a2
  assert.equal(result.sessions[0].userMessageCount, 1);
});

test('sqlite: an unrecognized table layout is a warned skip, not a silent zero', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('sqlite-unknown');
  const db = new DatabaseSync(join(dir, 'opencode.db'));
  try {
    db.exec('CREATE TABLE unrelated (id TEXT)');
  } finally {
    db.close();
  }
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.skipped, true);
  assert.deepEqual(result.buckets, []);
  assert.deepEqual(result.sessions, []);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /unrecognized table layout/);
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

for (const store of ['json', 'sqlite']) {
  test(store + ': nested model IDs carry usage even when the provider label is arbitrary', async t => {
    if (store === 'sqlite' && !DatabaseSync) return t.skip('node:sqlite unavailable');
    const dir = useDir('nested-' + store);
    const data = message('assistant', Date.parse('2026-11-22T12:00Z'), {
      modelID: undefined, model: { modelID: 'ABC/k3.1-pro', providerID: 'my-route' }, tokens: { cache: { read: 42 } },
    });
    if (store === 'sqlite') buildDb(dir, [{ sessionId: 'ses_nested', data }]);
    else {
      const session = join(dir, 'storage', 'message', 'ses_nested');
      mkdirSync(session, { recursive: true });
      writeFileSync(join(session, 'msg_one.json'), JSON.stringify(data));
    }
    const { buckets } = await parse({ sessionSalt: SALT });
    assert.deepEqual(buckets.map(b => [b.model, b.modelCanonical, b.modelProvider, b.cacheReadInputTokens, b.requestCount]),
      [['ABC/k3.1-pro', 'kimi-k3.1-pro', 'my-route', 42, 1]]);
  });
}

for (const layout of ['message', 'session_message']) {
  test(`large ${layout} databases do not overflow the function argument limit`, async (t) => {
    if (!DatabaseSync) return t.skip('node:sqlite unavailable');
    const dir = useDir(`large-${layout}`);
    const db = new DatabaseSync(join(dir, 'opencode.db'));
    const size = 150_001;
    const data = JSON.stringify(message('assistant', Date.parse('2026-08-01T10:02:00Z'), {
      tokens: { input: 1, output: 2 },
    }));
    try {
      db.exec(`CREATE TABLE ${layout} (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, data TEXT)`);
      db.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n < ?)
        INSERT INTO ${layout} SELECT printf('msg_%06d', n), 'ses_large', 'assistant', 1785578520000, ? FROM seq`).run(size, data);
    } finally { db.close(); }
    const result = await parse({ sessionSalt: SALT });
    assert.equal(result.skipped, undefined);
    assert.equal(result.warnings, undefined);
    assert.equal(sumTokens(result).input, size);
    assert.equal(sumTokens(result).output, size * 2);
    assert.equal(sumTokens(result).requests, size);
    assert.equal(result.sessions[0].messageCount, size);
  });
}

for (const failedTable of ['message', 'session_message']) {
  test(`an incompatible ${failedTable} table preserves the other layout as partial`, async (t) => {
    if (!DatabaseSync) return t.skip('node:sqlite unavailable');
    const dir = useDir(`partial-${failedTable}`);
    if (failedTable === 'session_message') {
      buildDb(dir, [{ sessionId: 'ses_1', data: message('assistant', Date.parse('2026-08-01T10:02:00Z'), { tokens: { input: 7, output: 3 } }) }]);
    } else {
      buildV2Db(dir, { messages: [v2Message('msg_1', 'ses_1', 'assistant', Date.parse('2026-08-01T10:02:00Z'), {
        modelID: 'kimi-k2', tokens: { input: 7, output: 3 },
      })] });
    }
    const db = new DatabaseSync(join(dir, 'opencode.db'));
    try { db.exec(`CREATE TABLE ${failedTable} (id TEXT)`); } finally { db.close(); }
    const result = await parse({ sessionSalt: SALT });
    assert.equal(result.skipped, true);
    assert.match(result.warnings[0], new RegExp(`could not read ${failedTable}`));
    assert.equal(sumTokens(result).input, 7);
    assert.equal(sumTokens(result).requests, 1);
  });
}

test('unreadable databases report partial even with an empty or healthy JSON fallback', async () => {
  const dir = useDir('corrupt-db');
  writeFileSync(join(dir, 'opencode.db'), 'not a database');
  const empty = await parse({ sessionSalt: SALT });
  assert.equal(empty.skipped, true);
  assert.deepEqual(empty.buckets, []);
  assert.match(empty.warnings[0], /incomplete SQLite scan/);
  const sessionDir = join(dir, 'storage', 'message', 'ses_fallback');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'msg.json'), JSON.stringify(message('assistant', Date.parse('2026-08-01T10:02:00Z'), {
    tokens: { input: 7, output: 3 },
  })));
  const fallback = await parse({ sessionSalt: SALT });
  assert.equal(fallback.skipped, true);
  assert.equal(sumTokens(fallback).input, 7);
});
