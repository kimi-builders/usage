import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCodeDataRoots } from '../src/opencode-roots.js';
import { parse, roots } from '../src/parsers/opencode.js';
import { readLocalGoKey } from '../src/limits/providers/opencode.js';

let DatabaseSync;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node runs the JSON fixtures */ }

const root = mkdtempSync(join(tmpdir(), 'kbu-opencode-roots-'));
after(() => rmSync(root, { recursive: true, force: true }));
const sessionSalt = 'fixture-salt'.padEnd(32, 'x');
function options(name) {
  const home = join(root, name);
  return { home, platform: 'win32', environment: { XDG_DATA_HOME: join(home, 'xdg'), LOCALAPPDATA: join(home, 'local') } };
}
function message(directory, id, input, session = 'ses_shared') {
  const target = join(directory, 'storage', 'message', session);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, `${id}.json`), JSON.stringify({
    id, sessionID: session, role: 'assistant', time: { created: 1791453600000 },
    modelID: 'gpt-5', tokens: { input, output: 1 }, path: { root: '/work/demo' },
  }));
}

test('OpenCode native Windows root supplements XDG; explicit overrides stay exclusive and deduplicated', () => {
  const { environment, home, platform } = options('resolution');
  assert.deepEqual(openCodeDataRoots(environment, home, platform), [join(home, 'xdg', 'opencode'), join(home, 'local', 'opencode')]);
  assert.deepEqual(openCodeDataRoots(environment, home, 'linux'), [join(home, 'xdg', 'opencode')]);
  assert.deepEqual(openCodeDataRoots({}, home, platform), [join(home, '.local', 'share', 'opencode'), join(home, 'AppData', 'Local', 'opencode')]);
  assert.deepEqual(openCodeDataRoots({ ...environment, KBU_USAGE_OPENCODE_DIR: `${home};${home};${home}/custom` }, home, platform), [home, `${home}/custom`]);
});

test('OpenCode scans both stores and deduplicates copied/overlapping session messages', async () => {
  const settings = options('overlap');
  const [xdg, native] = openCodeDataRoots(settings.environment, settings.home, settings.platform);
  message(xdg, 'msg_1', 1);
  message(native, 'msg_1', 100); // complete copy wins, not added to old copy
  message(native, 'msg_2', 20);
  message(native, 'msg_1', 5, 'ses_distinct'); // same id in another session is distinct
  assert.deepEqual(roots(settings), [xdg, native]);
  const result = await parse({ ...settings, sessionSalt });
  assert.equal(result.buckets.reduce((sum, row) => sum + row.inputTokens, 0), 125);
  assert.equal(result.buckets.reduce((sum, row) => sum + row.outputTokens, 0), 3);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions.reduce((sum, row) => sum + row.messageCount, 0), 3);
  assert.deepEqual(await parse({ ...settings, sessionSalt }), result);
});

test('one broken OpenCode store preserves healthy native usage and marks the source partial', async () => {
  const settings = options('partial');
  const [xdg, native] = openCodeDataRoots(settings.environment, settings.home, settings.platform);
  mkdirSync(xdg, { recursive: true });
  writeFileSync(join(xdg, 'opencode.db'), 'broken database');
  message(native, 'msg_1', 15);
  const result = await parse({ ...settings, sessionSalt });
  assert.equal(result.skipped, true);
  assert.equal(result.buckets[0].inputTokens, 15);
  assert.ok(result.warnings.length > 0);
});

test('OpenCode merges SQLite and JSON roots without counting either mirrored messages or stale JSON beside a DB', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const settings = options('mixed');
  const [xdg, native] = openCodeDataRoots(settings.environment, settings.home, settings.platform);
  message(xdg, 'msg_stale_json', 900); // SQLite remains authoritative in this root
  message(native, 'msg_1', 100);
  message(native, 'msg_2', 20);
  const db = new DatabaseSync(join(xdg, 'opencode.db'));
  try {
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)');
    const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?)');
    for (const [id, input, created] of [
      ['msg_1', 1, 1791453600000], // less complete DB mirror
      ['msg_2', 999, 'invalid'], // corrupt mirror cannot replace valid native data
      ['msg_3', 5, 1791453600000],
    ]) insert.run(id, 'ses_shared', JSON.stringify({ role: 'assistant', modelID: 'gpt-5',
      time: { created }, tokens: { input, output: 1 }, path: { root: '/work/demo' } }));
  } finally { db.close(); }
  const result = await parse({ ...settings, sessionSalt });
  assert.equal(result.buckets.reduce((sum, row) => sum + row.inputTokens, 0), 125);
  assert.equal(result.buckets.reduce((sum, row) => sum + row.requestCount, 0), 3);
  assert.equal(result.sessions[0].messageCount, 3);
  assert.deepEqual(await parse({ ...settings, sessionSalt }), result);
});

test('OpenCode scan and local Go credentials share native roots and override priority', async () => {
  const settings = options('credentials');
  const [, native] = openCodeDataRoots(settings.environment, settings.home, settings.platform);
  message(native, 'msg_1', 15);
  writeFileSync(join(native, 'auth.json'), JSON.stringify({ opencode: { key: 'fixture-key' } }));
  assert.equal(readLocalGoKey(settings.environment, settings.home, settings.platform).key, 'fixture-key');
  assert.equal((await parse({ ...settings, sessionSalt })).buckets[0].inputTokens, 15);
  const environment = { ...settings.environment, KBU_USAGE_OPENCODE_DIR: join(settings.home, 'explicit-empty') };
  assert.deepEqual(readLocalGoKey(environment, settings.home, settings.platform), { status: 'missing' });
  assert.equal(await parse({ ...settings, environment, sessionSalt }), null);
});
