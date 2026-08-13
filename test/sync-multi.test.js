import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

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
process.env.KBU_USAGE_CONFIG_DIR = join(root, 'config');
process.env.KBU_USAGE_STATE_DIR = stateDir;

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
const { runSync } = await import('../src/sync.js');
saveConfig({
  apiUrl: `http://127.0.0.1:${address.port}`,
  apiKey: `kbu_${'a'.repeat(43)}`,
  sessionSalt: 'fixture-session-salt'.padEnd(32, 'x'),
});

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
    ],
  );
  assert.ok(lines.some((line) => line.includes('- claude-code') && line.includes('未检测到')));
  assert.equal(received.length, 3); // another metadata heartbeat, still no usage rows

  const state = readStateFile();
  for (const key of claudeKeys) assert.equal(state.buckets[key], claudeStateBefore.buckets[key]);
  assert.equal(state.buckets[seededCodexBucketKey], 'seeded');
});
