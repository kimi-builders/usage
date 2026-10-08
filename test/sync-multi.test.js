import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Isolated fixtures for every source, set before importing sync.js so the
// developer's real HOME is never scanned.
const root = mkdtempSync(join(tmpdir(), 'kbu-sync-multi-test-'));
const kimiRoot = join(root, 'kimi-code');
const claudeRoot = join(root, 'claude');
const codexHome = join(root, 'codex');
const stateDir = join(root, 'state');
process.env.KBU_USAGE_KIMI_CODE_DIR = kimiRoot;
process.env.KBU_USAGE_KIMI_DIR = join(root, 'legacy-absent');
process.env.KBU_USAGE_CLAUDE_DIRS = claudeRoot;
process.env.KBU_USAGE_CODEX_HOME = codexHome;
process.env.KBU_USAGE_OPENCODE_DIR = join(root, 'opencode-absent');
process.env.KBU_USAGE_GEMINI_DIR = join(root, 'gemini-absent');
process.env.KBU_USAGE_ANTIGRAVITY_DIR = join(root, 'antigravity-absent');
process.env.KBU_USAGE_COPILOT_DIR = join(root, 'copilot-absent');
process.env.KBU_USAGE_ROO_DIRS = join(root, 'roo-absent');
process.env.KBU_USAGE_PI_SESSION_DIRS = join(root, 'pi-absent');
process.env.KBU_USAGE_ZCODE_DB = join(root, 'zcode-absent.sqlite');
process.env.KBU_USAGE_WORKBUDDY_DIRS = join(root, 'workbuddy-absent');
process.env.KBU_USAGE_GROK_SESSIONS = join(root, 'grok-absent');
process.env.KBU_USAGE_TRAE_CLI_SESSIONS = join(root, 'trae-absent');
process.env.KBU_USAGE_MCODE_DB = join(root, 'mcode-absent.sqlite');
for (const key of ['QODER_PROJECTS', 'QODER_DB', 'QODER_CN_PROJECTS', 'QODER_CN_DB', 'DSH_SESSIONS']) process.env['KBU_USAGE_' + key] = join(root, key + '-absent');
process.env.KBU_USAGE_CONFIG_DIR = join(root, 'config');
process.env.KBU_USAGE_STATE_DIR = stateDir;
process.env.KBU_USAGE_LANG = 'zh';

// kimi fixture: one bucket, one session.
const wireDir = join(kimiRoot, 'sessions', 'wd_demo_abcd', 'session_1', 'agents', 'main');
mkdirSync(wireDir, { recursive: true });
writeFileSync(join(wireDir, 'wire.jsonl'), `${[
  { type: 'turn.prompt', origin: { kind: 'user' }, time: Date.parse('2026-08-01T10:01:00.000Z') },
  { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 10, inputCacheCreation: 3, inputCacheRead: 4, output: 2 }, usageScope: 'turn', time: Date.parse('2026-08-01T10:02:00.000Z') },
].map(JSON.stringify).join('\n')}\n`, 'utf8');

// claude fixture: one bucket, one session.
const claudeProjectDir = join(claudeRoot, 'projects', '-Users-x-demo');
mkdirSync(claudeProjectDir, { recursive: true });
writeFileSync(join(claudeProjectDir, 'sess-1.jsonl'), `${[
  { type: 'user', timestamp: '2026-08-01T10:01:00.000Z', cwd: '/Users/x/demo', message: {} },
  { type: 'assistant', timestamp: '2026-08-01T10:02:00.000Z', cwd: '/Users/x/demo', uuid: 'c1', message: { model: 'claude-opus-4', usage: { input_tokens: 100, output_tokens: 20 } } },
].map(JSON.stringify).join('\n')}\n`, 'utf8');

// codex fixture that throws: a DIRECTORY named *.jsonl makes readFileSync
// fail (EISDIR), so the whole source is marked failed.
mkdirSync(join(codexHome, 'sessions', 'x.jsonl'), { recursive: true });

// Seed prior state for the failing codex source: it must survive every sync.
mkdirSync(stateDir, { recursive: true });
const seededCodexBucketKey = 'codex|gpt-5|demo|2026-01-01T00:00:00.000Z';
const seededCodexSessionKey = `codex|${'a'.repeat(64)}`;
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
  buckets: { [seededCodexBucketKey]: 'seeded' },
  sessions: { [seededCodexSessionKey]: 'seeded' },
}), 'utf8');

const received = [];
const server = createServer((request, response) => {
  if (request.url === '/api/usage/settings') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ uploadProject: false }));
    return;
  }
  if (request.url === '/api/usage/ingest' && request.method === 'POST') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received.push(JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8')));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        ingested: {
          buckets: received.at(-1).buckets.length,
          sessions: received.at(-1).sessions.length,
        },
      }));
    });
    return;
  }
  response.statusCode = 404;
  response.end('{}');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

const { saveConfig } = await import('../src/config.js');
const { syncTargetKey } = await import('../src/state.js');
const { runSync } = await import('../src/sync.js');
const syncConfig = {
  apiUrl: `http://127.0.0.1:${address.port}`,
  apiKey: `kbu_${'a'.repeat(43)}`,
  sessionSalt: 'fixture-session-salt'.padEnd(32, 'x'),
};
saveConfig(syncConfig);

// This fixture represents an already-bound checkpoint. Legacy checkpoints
// without a target intentionally require one explicit full replay.
const seededState = JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({
  ...seededState,
  syncTarget: syncTargetKey(syncConfig),
}), 'utf8');

function readStateFile() {
  return JSON.parse(readFileSync(join(stateDir, 'state.json'), 'utf8'));
}

async function runQuietlyCaptured() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const result = await runSync();
    return { result, lines };
  } finally {
    console.log = original;
  }
}

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

test('a failing source never blocks the others, and its old state survives', async () => {
  const { result, lines } = await runQuietlyCaptured();
  assert.deepEqual(
    result.sources.map(({ source, status }) => ({ source, status })),
    [
      { source: 'kimi-code', status: 'ok' },
      { source: 'claude-code', status: 'ok' },
      { source: 'codex', status: 'failed' },
      { source: 'opencode', status: 'skipped' },
      { source: 'gemini-cli', status: 'skipped' },
      { source: 'antigravity', status: 'skipped' },
      { source: 'copilot-cli', status: 'skipped' },
      { source: 'roo-code', status: 'skipped' },
      { source: 'pi-coding-agent', status: 'skipped' },
      { source: 'zcode', status: 'skipped' },
      { source: 'workbuddy', status: 'skipped' },
      { source: 'grok', status: 'skipped' },
      { source: 'trae-cli', status: 'skipped' },
      { source: 'mcode', status: 'skipped' },
      { source: 'qoder', status: 'skipped' },
      { source: 'qoder-cn', status: 'skipped' },
      { source: 'dsh', status: 'skipped' },
    ],
  );
  assert.equal(typeof result.sources[2].error, 'string');
  // kimi + claude data still uploaded, exit-ok path (no throw).
  assert.equal(result.buckets, 2);
  assert.equal(result.sessions, 2);
  assert.equal(received.length, 1);
  assert.deepEqual(
    received[0].buckets.map((bucket) => bucket.source).sort(),
    ['claude-code', 'kimi-code'],
  );

  // Per-source Chinese report.
  assert.ok(lines.some((line) => line.includes('来源扫描')));
  assert.ok(lines.some((line) => line.includes('✓ kimi-code')));
  assert.ok(lines.some((line) => line.includes('✗ codex') && line.includes('解析失败')));
  assert.ok(lines.some((line) => line.includes('已同步 2 buckets · 2 sessions')));
  assert.ok(lines.some((line) => line.includes('部分来源解析失败')));

  // The failing source's prior state is NOT pruned.
  const state = readStateFile();
  assert.equal(state.buckets[seededCodexBucketKey], 'seeded');
  assert.equal(state.sessions[seededCodexSessionKey], 'seeded');
});

test('unchanged fixtures upload nothing and still exit ok with a failing source', async () => {
  const { result, lines } = await runQuietlyCaptured();
  assert.equal(result.buckets, 0);
  assert.equal(result.sessions, 0);
  assert.equal(received.length, 2); // metadata heartbeat, no usage rows
  assert.deepEqual(received[1].buckets, []);
  assert.deepEqual(received[1].sessions, []);
  assert.ok(lines.some((line) => line.includes('暂无新增或变化的用量。')));
  const state = readStateFile();
  assert.equal(state.buckets[seededCodexBucketKey], 'seeded');
});

test("a skipped source's state survives too", async () => {
  const claudeStateBefore = readStateFile();
  const claudeKeys = Object.keys(claudeStateBefore.buckets).filter((key) => key.startsWith('claude-code|'));
  assert.ok(claudeKeys.length > 0);

  // Uninstall claude (roots vanish → skipped), then sync again.
  renameSync(claudeRoot, join(root, 'claude-gone'));
  const { result, lines } = await runQuietlyCaptured();
  assert.deepEqual(
    result.sources.map(({ source, status }) => ({ source, status })),
    [
      { source: 'kimi-code', status: 'ok' },
      { source: 'claude-code', status: 'skipped' },
      { source: 'codex', status: 'failed' },
      { source: 'opencode', status: 'skipped' },
      { source: 'gemini-cli', status: 'skipped' },
      { source: 'antigravity', status: 'skipped' },
      { source: 'copilot-cli', status: 'skipped' },
      { source: 'roo-code', status: 'skipped' },
      { source: 'pi-coding-agent', status: 'skipped' },
      { source: 'zcode', status: 'skipped' },
      { source: 'workbuddy', status: 'skipped' },
      { source: 'grok', status: 'skipped' },
      { source: 'trae-cli', status: 'skipped' },
      { source: 'mcode', status: 'skipped' },
      { source: 'qoder', status: 'skipped' },
      { source: 'qoder-cn', status: 'skipped' },
      { source: 'dsh', status: 'skipped' },
    ],
  );
  assert.ok(lines.some((line) => line.includes('- claude-code') && line.includes('未检测到')));
  assert.equal(received.length, 3); // another metadata heartbeat, still no usage rows

  const state = readStateFile();
  for (const key of claudeKeys) assert.equal(state.buckets[key], claudeStateBefore.buckets[key]);
  assert.equal(state.buckets[seededCodexBucketKey], 'seeded');
});

for (const damagedTail of [false, true]) {
  test(`DSH ${damagedTail ? 'unfinished tail' : 'middle corruption'} keeps missing checkpoint keys and recovers on repair`, async () => {
    const oldRoot = process.env.KBU_USAGE_DSH_SESSIONS;
    const oldState = readFileSync(join(stateDir, 'state.json'));
    const sessions = join(root, `dsh-${damagedTail}`);
    const directory = join(sessions, 'project', 'session'); mkdirSync(directory, { recursive: true });
    const path = join(directory, 'session.jsonl');
    const records = [
      { type: 'session', version: 0, id: 'checkpoint', cwd: '/safe/project' },
      { type: 'user/message', seq: 1, time: '2026-09-01T10:00:00Z', data: { source: { kind: 'user' } } },
      { type: 'assistant/message', seq: 2, time: '2026-09-01T10:01:00Z', data: { message: { source: { model: 'deepseek-v4-pro' } }, usage: { inputTokens: 100, outputTokens: 20 } } },
      { type: 'assistant/message', seq: 3, time: '2026-09-01T11:01:00Z', data: { message: { source: { model: 'deepseek-v4-pro' } }, usage: { inputTokens: 200, outputTokens: 30 } } },
    ];
    process.env.KBU_USAGE_DSH_SESSIONS = sessions;
    saveConfig({ ...syncConfig, sourcePolicies: { dsh: 'private' } });
    try {
      writeFileSync(path, records.map(JSON.stringify).join('\n') + '\n');
      const complete = await runSync({ quiet: true });
      assert.equal(complete.sources.find(s => s.source === 'dsh').status, 'ok');
      const before = readStateFile();
      const missing = Object.keys(before.buckets).find(key => key.startsWith('dsh|') && key.includes('11:00:00'));
      assert.ok(missing);
      const corrupt = records.slice(0, 3).map(JSON.stringify).join('\n') + '\n{broken-json';
      writeFileSync(path, corrupt + (damagedTail ? '' : '\n' + JSON.stringify({ type: 'session/end', time: '2026-09-01T11:02:00Z' }) + '\n'));
      const partial = await runSync({ quiet: true });
      assert.equal(partial.sources.find(s => s.source === 'dsh').status, 'partial');
      assert.equal(readStateFile().buckets[missing], before.buckets[missing]);
      assert.equal(readStateFile().buckets[seededCodexBucketKey], 'seeded');
      records[3].data.usage.inputTokens = 250;
      writeFileSync(path, records.map(JSON.stringify).join('\n') + '\n');
      const repaired = await runSync({ quiet: true });
      assert.equal(repaired.sources.find(s => s.source === 'dsh').status, 'ok');
      assert.notEqual(readStateFile().buckets[missing], before.buckets[missing]);
    } finally {
      process.env.KBU_USAGE_DSH_SESSIONS = oldRoot;
      writeFileSync(join(stateDir, 'state.json'), oldState);
      saveConfig(syncConfig);
    }
  });
}

test('Grok unreadable usage preserves missing checkpoints while healthy sessions still upload', async () => {
  const previous = process.env.KBU_USAGE_GROK_SESSIONS;
  const oldState = readFileSync(join(stateDir, 'state.json'));
  const sessions = join(root, 'grok-partial');
  const writeSession = (id, inputTokens) => {
    const directory = join(sessions, encodeURIComponent('/work/demo'), id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'summary.json'), JSON.stringify({ info: { cwd: '/work/demo' }, current_model_id: 'grok-4.6' }));
    writeFileSync(join(directory, 'updates.jsonl'), JSON.stringify({ timestamp: 1790000010,
      params: { update: { sessionUpdate: 'turn_completed', ...(inputTokens == null ? {} : { usage: { inputTokens, outputTokens: 10 } }) } } }) + '\n');
    writeFileSync(join(directory, 'signals.json'), JSON.stringify({ turnCount: 1, modelsUsed: ['grok-4.6'] }));
  };
  process.env.KBU_USAGE_GROK_SESSIONS = sessions;
  saveConfig({ ...syncConfig, sourcePolicies: { grok: 'private' } });
  try {
    writeSession('unread', null);
    writeSession('healthy', 200);
    const before = readStateFile();
    const key = 'grok|grok-4.6|demo|2026-01-01T00:00:00.000Z';
    const sessionKey = `grok|${'b'.repeat(64)}`;
    before.buckets[key] = 'prior'; before.sessions[sessionKey] = 'prior';
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(before));
    const partial = await runSync({ quiet: true });
    assert.equal(partial.sources.find(s => s.source === 'grok').status, 'partial');
    assert.ok(partial.buckets > 0);
    assert.equal(readStateFile().buckets[key], 'prior');
    assert.equal(readStateFile().sessions[sessionKey], 'prior');
    writeSession('unread', 300);
    const repaired = await runSync({ quiet: true });
    assert.equal(repaired.sources.find(s => s.source === 'grok').status, 'ok');
    assert.equal(readStateFile().buckets[key], undefined);
  } finally {
    process.env.KBU_USAGE_GROK_SESSIONS = previous;
    writeFileSync(join(stateDir, 'state.json'), oldState);
    saveConfig(syncConfig);
  }
});

test('MiniMax extra-store failures preserve checkpoints without blocking healthy uploads', async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return t.skip('node:sqlite unavailable'); }
  const fixtureHome = join(root, 'mcode-partial');
  const oldState = readFileSync(join(stateDir, 'state.json'));
  const relative = join('v2', 'sqlite');
  const primaryDir = join(fixtureHome, '.minimax', relative);
  const brokenDir = join(fixtureHome, '.minimax-broken', relative);
  mkdirSync(primaryDir, { recursive: true }); mkdirSync(brokenDir, { recursive: true });
  const database = new DatabaseSync(join(primaryDir, 'runtime-state.sqlite'));
  database.exec(`CREATE TABLE local_runtime_sessions (session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT);
    CREATE TABLE local_runtime_token_usage (id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, ts INTEGER,
      input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER);
    INSERT INTO local_runtime_sessions VALUES ('healthy', '/work/demo', NULL);
    INSERT INTO local_runtime_token_usage VALUES (1, 'healthy', 'MiniMax-M3', 1787935277463, 100, 20, 0, 0, 0);`);
  database.close();
  const brokenPath = join(brokenDir, 'runtime-state.sqlite');
  writeFileSync(brokenPath, 'not a database');
  const env = { ...process.env, HOME: fixtureHome, USERPROFILE: fixtureHome };
  for (const key of ['KBU_USAGE_MCODE_DB', 'MCODE_HOME', 'MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR']) delete env[key];
  const run = async () => JSON.parse((await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    'import { runSync } from "./src/sync.js"; console.log(JSON.stringify(await runSync({quiet:true})));',
  ], { cwd: new URL('..', import.meta.url), env })).stdout);
  saveConfig({ ...syncConfig, sourcePolicies: { mcode: 'private' } });
  try {
    const before = readStateFile();
    const key = 'mcode|MiniMax-M3|demo|2026-01-01T00:00:00.000Z';
    before.buckets[key] = 'prior';
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(before));
    const partial = await run();
    assert.equal(partial.sources.find(s => s.source === 'mcode').status, 'partial');
    assert.ok(partial.buckets > 0);
    assert.equal(readStateFile().buckets[key], 'prior');
    // Move only the synthetic broken file out of discovery; no real user data is touched.
    renameSync(brokenPath, join(root, 'mcode-broken-fixture.saved'));
    assert.equal((await run()).sources.find(s => s.source === 'mcode').status, 'ok');
    assert.equal(readStateFile().buckets[key], undefined);
  } finally {
    writeFileSync(join(stateDir, 'state.json'), oldState);
    saveConfig(syncConfig);
  }
});

test('OpenCode SQLite failures retain checkpoints and still upload the readable layout', async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { return t.skip('node:sqlite unavailable'); }
  const previous = process.env.KBU_USAGE_OPENCODE_DIR;
  const oldState = readFileSync(join(stateDir, 'state.json'));
  const directory = join(root, 'opencode-partial');
  mkdirSync(directory, { recursive: true });
  process.env.KBU_USAGE_OPENCODE_DIR = directory;
  const path = join(directory, 'opencode.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE session_message (id TEXT)');
    db.prepare('INSERT INTO message VALUES (?, ?, ?)').run('msg_1', 'ses_1', JSON.stringify({
      role: 'assistant', modelID: 'kimi-k2', time: { created: Date.parse('2026-09-01T10:00:00Z') },
      tokens: { input: 100, output: 20 },
    }));
  } finally { db.close(); }
  saveConfig({ ...syncConfig, sourcePolicies: { opencode: 'private' } });
  try {
    const before = readStateFile();
    const key = 'opencode|kimi-k2|private|2026-01-01T00:00:00.000Z';
    const sessionKey = `opencode|${'d'.repeat(64)}`;
    before.buckets[key] = 'prior'; before.sessions[sessionKey] = 'prior';
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(before));
    const partial = await runSync({ quiet: true });
    assert.equal(partial.sources.find(s => s.source === 'opencode').status, 'partial');
    assert.ok(received.at(-1).buckets.some(bucket => bucket.source === 'opencode' && bucket.inputTokens === 100));
    assert.equal(readStateFile().buckets[key], 'prior');
    assert.equal(readStateFile().sessions[sessionKey], 'prior');

    const repair = new DatabaseSync(path);
    try { repair.exec('DROP TABLE session_message'); } finally { repair.close(); }
    assert.equal((await runSync({ quiet: true })).sources.find(s => s.source === 'opencode').status, 'ok');
    assert.equal(readStateFile().buckets[key], undefined);
    const completedState = readStateFile();
    const healthyKey = Object.keys(completedState.buckets).find(value => value.startsWith('opencode|'));
    assert.ok(healthyKey);
    writeFileSync(path, 'synthetic corrupt database');
    assert.equal((await runSync({ quiet: true })).sources.find(s => s.source === 'opencode').status, 'partial');
    assert.equal(readStateFile().buckets[healthyKey], completedState.buckets[healthyKey]);
  } finally {
    process.env.KBU_USAGE_OPENCODE_DIR = previous;
    writeFileSync(join(stateDir, 'state.json'), oldState);
    saveConfig(syncConfig);
  }
});

test('invalid Codex durable records preserve prior checkpoints while healthy requests still sync', async () => {
  const previous = process.env.KBU_USAGE_CODEX_HOME;
  const oldState = readFileSync(join(stateDir, 'state.json'));
  const directory = join(root, 'codex-durable-partial');
  mkdirSync(join(directory, 'sessions'), { recursive: true });
  process.env.KBU_USAGE_CODEX_HOME = directory;
  const path = join(directory, 'sessions', 'rollout.jsonl');
  const timestamp = '2026-10-08T10:00:00Z';
  const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
  writeFileSync(path, [
    { type: 'session_meta', timestamp, payload: { id: 'fixture-thread' } },
    { type: 'turn_context', timestamp, payload: { model: 'gpt-5' } },
    { type: 'token_usage_record', timestamp, payload: { usage: { input_tokens: -1 }, thread_token_usage: usage } },
    { type: 'token_usage_record', timestamp, payload: { usage, thread_token_usage: usage } },
  ].map(JSON.stringify).join('\n') + '\n');
  saveConfig({ ...syncConfig, sourcePolicies: { codex: 'private' } });
  try {
    const before = readStateFile();
    before.buckets[seededCodexBucketKey] = 'prior-durable';
    before.sessions[seededCodexSessionKey] = 'prior-durable';
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(before));
    const result = await runSync({ quiet: true });
    assert.equal(result.sources.find((source) => source.source === 'codex').status, 'partial');
    assert.ok(received.at(-1).buckets.some((bucket) => bucket.source === 'codex' && bucket.inputTokens === 100));
    assert.equal(readStateFile().buckets[seededCodexBucketKey], 'prior-durable');
    assert.equal(readStateFile().sessions[seededCodexSessionKey], 'prior-durable');
  } finally {
    process.env.KBU_USAGE_CODEX_HOME = previous;
    writeFileSync(join(stateDir, 'state.json'), oldState);
    saveConfig(syncConfig);
  }
});

test('ambiguous mixed Grok turns protect checkpoints until the ledger can be reconciled', async () => {
  const previous = process.env.KBU_USAGE_GROK_SESSIONS;
  const oldState = readFileSync(join(stateDir, 'state.json'));
  const sessions = join(root, 'grok-mixed-partial');
  const directory = join(sessions, 'demo', 'session-mixed');
  mkdirSync(directory, { recursive: true });
  process.env.KBU_USAGE_GROK_SESSIONS = sessions;
  const first = { inputTokens: 100, outputTokens: 10 };
  const second = { inputTokens: 200, outputTokens: 20 };
  writeFileSync(join(directory, 'summary.json'), JSON.stringify({ current_model_id: 'grok-4.5' }));
  writeFileSync(join(directory, 'updates.jsonl'), [
    { timestamp: '2026-09-01T10:00:00Z', params: { update: { sessionUpdate: 'turn_completed', usage: first } } },
    { timestamp: '2026-09-02T10:00:00Z', params: { update: { sessionUpdate: 'turn_completed' } } },
  ].map(JSON.stringify).join('\n') + '\n');
  const ledgerPath = join(directory, 'usage.json');
  writeFileSync(ledgerPath, JSON.stringify({ session: { inputTokens: 300, outputTokens: 30 } }));
  saveConfig({ ...syncConfig, sourcePolicies: { grok: 'private' } });
  try {
    const before = readStateFile();
    const key = 'grok|grok-4.5|private|2026-01-01T00:00:00.000Z';
    const sessionKey = `grok|${'e'.repeat(64)}`;
    before.buckets[key] = 'prior'; before.sessions[sessionKey] = 'prior';
    writeFileSync(join(stateDir, 'state.json'), JSON.stringify(before));
    const partial = await runSync({ quiet: true });
    assert.equal(partial.sources.find(s => s.source === 'grok').status, 'partial');
    assert.ok(received.at(-1).buckets.some(bucket => bucket.source === 'grok' && bucket.inputTokens === 100));
    assert.equal(readStateFile().buckets[key], 'prior');
    assert.equal(readStateFile().sessions[sessionKey], 'prior');
    writeFileSync(ledgerPath, JSON.stringify({ turns: [{ turnNumber: 1, ...first }, { turnNumber: 2, ...second }] }));
    const complete = await runSync({ quiet: true });
    assert.equal(complete.sources.find(s => s.source === 'grok').status, 'ok');
    assert.ok(received.at(-1).buckets.some(bucket => bucket.source === 'grok' && bucket.inputTokens === 200));
    assert.equal(readStateFile().buckets[key], undefined);
    assert.equal(readStateFile().sessions[sessionKey], undefined);
  } finally {
    process.env.KBU_USAGE_GROK_SESSIONS = previous;
    writeFileSync(join(stateDir, 'state.json'), oldState);
    saveConfig(syncConfig);
  }
});
