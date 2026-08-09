import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = mkdtempSync(join(tmpdir(), 'kbu-sync-test-'));
const currentRoot = join(root, 'kimi-code');
const legacyRoot = join(root, 'legacy');
process.env.KBU_USAGE_KIMI_CODE_DIR = currentRoot;
process.env.KBU_USAGE_KIMI_DIR = legacyRoot;
process.env.KBU_USAGE_CONFIG_DIR = join(root, 'config');
process.env.KBU_USAGE_STATE_DIR = join(root, 'state');
// Point the other sources at nonexistent fixtures so the developer's real
// ~/.claude / ~/.codex / ... are never scanned by the multi-source collector.
process.env.KBU_USAGE_CLAUDE_DIRS = join(root, 'claude-absent');
process.env.KBU_USAGE_CODEX_HOME = join(root, 'codex-absent');
process.env.KBU_USAGE_OPENCODE_DIR = join(root, 'opencode-absent');
process.env.KBU_USAGE_GEMINI_DIR = join(root, 'gemini-absent');
process.env.KBU_USAGE_ANTIGRAVITY_DIR = join(root, 'antigravity-absent');
process.env.KBU_USAGE_COPILOT_DIR = join(root, 'copilot-absent');
process.env.KBU_USAGE_ROO_DIRS = join(root, 'roo-absent');

const wireDir = join(currentRoot, 'sessions', 'wd_private-project_abcd', 'session_1', 'agents', 'main');
mkdirSync(wireDir, { recursive: true });
writeFileSync(join(wireDir, 'wire.jsonl'), `${[
  { type: 'turn.prompt', origin: { kind: 'user' }, time: Date.parse('2026-08-01T10:01:00.000Z') },
  {
    type: 'usage.record',
    model: 'kimi-code/k3',
    usage: { inputOther: 10, inputCacheCreation: 3, inputCacheRead: 4, output: 2 },
    usageScope: 'turn',
    time: Date.parse('2026-08-01T10:02:00.000Z'),
  },
].map(JSON.stringify).join('\n')}\n`, 'utf8');

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

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(root, { recursive: true, force: true });
});

test('repeat sync sends no duplicate batch and hidden projects never enter payloads', async () => {
  const first = await runSync({ quiet: true });
  const second = await runSync({ quiet: true });
  assert.equal(first.buckets, 1);
  assert.equal(first.sessions, 1);
  assert.deepEqual(
    first.sources.map(({ source, status }) => ({ source, status })),
    [
      { source: 'kimi-code', status: 'ok' },
      { source: 'claude-code', status: 'skipped' },
      { source: 'codex', status: 'skipped' },
      { source: 'opencode', status: 'skipped' },
      { source: 'gemini-cli', status: 'skipped' },
      { source: 'antigravity', status: 'skipped' },
      { source: 'copilot-cli', status: 'skipped' },
      { source: 'roo-code', status: 'skipped' },
    ],
  );
  assert.equal(second.buckets, 0);
  assert.equal(second.sessions, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0].protocolVersion, 2);
  assert.equal('project' in received[0].buckets[0], false);
  assert.equal('project' in received[0].sessions[0], false);
  assert.deepEqual(
    {
      input: received[0].buckets[0].inputTokens,
      cacheWrite: received[0].buckets[0].cacheWriteInputTokens,
      cacheRead: received[0].buckets[0].cacheReadInputTokens,
      output: received[0].buckets[0].outputTokens,
    },
    { input: 10, cacheWrite: 3, cacheRead: 4, output: 2 },
  );
});
