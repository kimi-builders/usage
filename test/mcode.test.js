import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, resolveMcodeDbPath, resolveMcodeDbPaths } from '../src/parsers/mcode.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}

const SCHEMA = `CREATE TABLE local_runtime_sessions (
 session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT);
CREATE TABLE local_runtime_token_usage (
 id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, ts INTEGER,
 input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
 cache_read_tokens INTEGER, cache_write_tokens INTEGER);`;

async function writeDb(path, sqlText) {
  mkdirSync(dirname(path), { recursive: true });
  if (DatabaseSync) {
    const db = new DatabaseSync(path);
    try {
      db.exec(sqlText);
    } finally {
      db.close();
    }
  } else {
    execFileSync('sqlite3', [path, sqlText]);
  }
}

function sessionRow(id, workspace, project = null) {
  return `INSERT INTO local_runtime_sessions VALUES ('${id}', '${workspace}', ${project ? `'${project}'` : 'NULL'});`;
}

// model NULL mirrors the mcode 0.5.5 writer, which leaves the column empty.
function tokenRow(id, ts, input, output, reasoning = 0, cacheRead = 0, cacheWrite = 0) {
  return `INSERT INTO local_runtime_token_usage VALUES (NULL, '${id}', NULL, ${ts}, ${input}, ${output}, ${reasoning}, ${cacheRead}, ${cacheWrite});`;
}

test('MiniMax Code reads only token ledger fields with exclusive cache accounting', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'kbu-mcode-'));
  const path = join(directory, 'runtime-state.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);
    db.prepare('INSERT INTO local_runtime_sessions VALUES (?, ?, ?)')
      .run('s1', '/tmp/session', '/work/project-a');
    db.prepare('INSERT INTO local_runtime_token_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(1, 's1', 'MiniMax-M3', 1_787_935_277_463, 10, 9, 3, 4, 5);
  } finally {
    db.close();
  }
  const previous = process.env.KBU_USAGE_MCODE_DB;
  process.env.KBU_USAGE_MCODE_DB = path;
  try {
    const result = await parse();
    assert.deepEqual(result.buckets[0], {
      source: 'mcode', model: 'MiniMax-M3', project: 'project-a',
      bucketStart: '2026-08-28T16:30:00.000Z', inputTokens: 10,
      cacheWriteInputTokens: 5, cacheReadInputTokens: 4, outputTokens: 9,
      reasoningOutputTokens: 3, requestCount: 1, measurement: 'exact',
    });
    assert.equal(JSON.stringify(result).includes('/work/'), false);
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_MCODE_DB;
    else process.env.KBU_USAGE_MCODE_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('MiniMax Code path precedence validates MCODE_HOME and the CLI relocation variables', () => {
  assert.equal(resolveMcodeDbPath({ KBU_USAGE_MCODE_DB: '/tmp/mcode.sqlite' }), '/tmp/mcode.sqlite');
  const home = join(tmpdir(), 'minimax');
  assert.equal(resolveMcodeDbPath({ MCODE_HOME: home }), join(home, 'v2', 'sqlite', 'runtime-state.sqlite'));
  // The mcode CLI itself relocates the whole data root with these variables.
  assert.equal(
    resolveMcodeDbPath({ MINIMAX_DATA_DIR: home }),
    join(home, 'v2', 'sqlite', 'runtime-state.sqlite'),
  );
  assert.equal(
    resolveMcodeDbPath({ MAVIS_DATA_DIR: home }),
    join(home, 'v2', 'sqlite', 'runtime-state.sqlite'),
  );
  // The fixture override beats the CLI's own variables, which keep their order.
  assert.equal(
    resolveMcodeDbPath({ MCODE_HOME: '/tmp/mcode-home', MINIMAX_DATA_DIR: home }),
    join('/tmp/mcode-home', 'v2', 'sqlite', 'runtime-state.sqlite'),
  );
  // An explicit root keeps its single path even when the file is missing.
  assert.deepEqual(resolveMcodeDbPaths({ MINIMAX_DATA_DIR: home }, '/no-such-home'), [join(home, 'v2', 'sqlite', 'runtime-state.sqlite')]);
  assert.throws(() => resolveMcodeDbPath({ MCODE_HOME: 'relative' }), /MCODE_HOME must be an absolute path/);
  assert.throws(() => resolveMcodeDbPath({ MINIMAX_DATA_DIR: 'relative/minimax' }), /MINIMAX_DATA_DIR must be an absolute path/);
  assert.throws(() => resolveMcodeDbPaths({ MAVIS_DATA_DIR: 'relative/mavis' }), /MAVIS_DATA_DIR must be an absolute path/);
});

// parse() resolves homedir() itself, so multi-store discovery runs in a child
// process with a fake home — os.homedir() follows HOME on POSIX and
// USERPROFILE on Windows. Ambient locator variables are dropped so a developer
// machine's real stores cannot leak into the fixture.
function parseInHome(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of ['KBU_USAGE_MCODE_DB', 'MCODE_HOME', 'MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR']) delete env[key];
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    'import { parse } from "./src/parsers/mcode.js";console.log(JSON.stringify(await parse()));',
  ], { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' }));
}

test('MiniMax Code scans profile, legacy and pre-rename stores once each', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const home = mkdtempSync(join(tmpdir(), 'kbu-mcode-home-'));
  const relative = join('v2', 'sqlite', 'runtime-state.sqlite');
  const primary = join(home, '.minimax', relative);
  const legacy = join(home, '.minimax-code', relative);
  const profile = join(home, '.minimax-work', relative);
  const migratedRow = tokenRow('s1', 1_787_935_277_463, 10, 2);
  try {
    await writeDb(primary, `${SCHEMA}${sessionRow('s1', '/work/primary')}${migratedRow}`);
    // A pre-npm source-build store keeps its own history plus a copy of the
    // row the CLI's migration already carried into ~/.minimax…
    await writeDb(legacy, `${SCHEMA}${sessionRow('s1', '/work/primary')}${sessionRow('s9', '/work/old')}${migratedRow}${tokenRow('s9', 1_787_931_677_463, 3, 1)}`);
    await writeDb(profile, `${SCHEMA}${sessionRow('s2', '/work/profile')}${tokenRow('s2', 1_787_935_277_463, 5, 0, 0, 2, 0)}`);
    // …while the CLI's compat migration leaves ~/.mavis pointing at ~/.minimax.
    try { symlinkSync(join(home, '.minimax'), join(home, '.mavis'), 'dir'); } catch { /* platform without symlink support */ }

    assert.deepEqual(resolveMcodeDbPaths({}, home), [primary, legacy, profile]);

    const result = parseInHome(home);

    assert.equal(result.skipped, undefined);
    assert.deepEqual(
      result.buckets.map((bucket) => [bucket.project, bucket.inputTokens, bucket.cacheReadInputTokens, bucket.outputTokens]).sort(),
      [
        ['old', 3, 0, 1],
        ['primary', 10, 0, 2],
        ['profile', 5, 2, 0],
      ].sort(),
    );
    // The migrated copy of s1 in the legacy store must not double-count.
    assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.requestCount, 0), 3);
    // mcode 0.5.5 writes model NULL, so these buckets can only say unknown.
    assert.ok(result.buckets.every((bucket) => bucket.model === 'unknown'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('MiniMax Code keeps the live store when an extra store is incompatible', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const home = mkdtempSync(join(tmpdir(), 'kbu-mcode-extra-'));
  const relative = join('v2', 'sqlite', 'runtime-state.sqlite');
  try {
    await writeDb(join(home, '.minimax', relative), `${SCHEMA}${sessionRow('s1', '/work/live')}${tokenRow('s1', 1_787_935_277_463, 4, 2)}`);
    // A leftover profile store this build cannot read must surface as a
    // warning, not blank the store the CLI is actually writing to.
    await writeDb(join(home, '.minimax-broken', relative), 'CREATE TABLE local_runtime_token_usage (session_id TEXT);');

    const result = parseInHome(home);

    assert.equal(result.skipped, true);
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0].project, 'live');
    assert.equal(result.buckets[0].inputTokens, 4);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /skipping incompatible database/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('MiniMax Code keeps duplicate ledger rows inside one store', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'kbu-mcode-dup-'));
  const path = join(directory, 'runtime-state.sqlite');
  const row = tokenRow('s1', 1_787_935_277_463, 4, 2);
  await writeDb(path, `${SCHEMA}${sessionRow('s1', '/work/dup')}${row}${row}`);
  const previous = process.env.KBU_USAGE_MCODE_DB;
  process.env.KBU_USAGE_MCODE_DB = path;
  try {
    const result = await parse();
    // Within a single store repeated rows are the ledger, not copies.
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0].inputTokens, 8);
    assert.equal(result.buckets[0].requestCount, 2);
    assert.equal(result.warnings, undefined);
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_MCODE_DB;
    else process.env.KBU_USAGE_MCODE_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('MiniMax Code returns skipped when the primary database is incompatible', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const directory = mkdtempSync(join(tmpdir(), 'kbu-mcode-bad-'));
  const path = join(directory, 'runtime-state.sqlite');
  await writeDb(path, 'CREATE TABLE local_runtime_token_usage (session_id TEXT);');
  const previous = process.env.KBU_USAGE_MCODE_DB;
  process.env.KBU_USAGE_MCODE_DB = path;
  try {
    const result = await parse();
    // The fail-soft contract protects the incremental sync state for mcode.
    assert.deepEqual(result, { buckets: [], sessions: [], skipped: true });
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_MCODE_DB;
    else process.env.KBU_USAGE_MCODE_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
