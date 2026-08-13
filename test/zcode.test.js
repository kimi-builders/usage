import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kbu-zcode-test-'));
process.env.KBU_USAGE_ZCODE_DB = join(root, 'absent.sqlite');
const { parse, roots } = await import('../src/parsers/zcode.js');
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}
const SALT = 'zcode-test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

test('missing ZCode database reports not installed', async () => {
  assert.deepEqual(roots(), []);
  assert.equal(await parse({ sessionSalt: SALT }), null);
});

test('ZCode reads SQLite usage as exclusive fields and keeps provider/model facts', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const path = join(root, 'zcode.sqlite');
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE message (session_id TEXT, time_created INTEGER, data TEXT)');
    db.prepare('INSERT INTO session (id, directory) VALUES (?, ?)').run('session-1', '/private/work/z-project');
    const insert = db.prepare('INSERT INTO message (session_id, time_created, data) VALUES (?, ?, ?)');
    insert.run('session-1', Date.parse('2026-08-10T10:00:01.000Z'), JSON.stringify({ role: 'user' }));
    insert.run('session-1', Date.parse('2026-08-10T10:00:06.000Z'), JSON.stringify({
      role: 'assistant', modelID: 'glm-5', providerID: 'zai',
      path: { root: '/private/work/z-project' },
      tokens: { input: 130, output: 40, reasoning: 10, cache: { read: 30, write: 20 } },
    }));
  } finally { db.close(); }
  process.env.KBU_USAGE_ZCODE_DB = path;
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(result.buckets[0], {
    source: 'zcode', model: 'glm-5', modelProvider: 'zai', project: 'z-project',
    bucketStart: '2026-08-10T10:00:00.000Z', inputTokens: 100,
    cacheWriteInputTokens: 20, cacheReadInputTokens: 30, outputTokens: 30,
    reasoningOutputTokens: 10, requestCount: 1, measurement: 'exact',
  });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].messageCount, 2);
  assert.equal(result.sessions[0].sessionHash.length, 64);
  assert.equal(JSON.stringify(result).includes('/private/work'), false);
});
