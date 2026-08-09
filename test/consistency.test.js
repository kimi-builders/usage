import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Frozen cross-repo consistency fixture: the same raw logs must produce the
// exact same aggregates here and in the site's server-side tests.
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/consistency.json', import.meta.url), 'utf8'),
);

const root = mkdtempSync(join(tmpdir(), 'kbu-consistency-test-'));
const kimiRoot = join(root, 'kimi-code');
const claudeRoot = join(root, 'claude');
const codexHome = join(root, 'codex');
process.env.KBU_USAGE_KIMI_CODE_DIR = kimiRoot;
process.env.KBU_USAGE_KIMI_DIR = join(root, 'kimi-legacy-absent');
process.env.KBU_USAGE_CLAUDE_DIRS = claudeRoot;
process.env.KBU_USAGE_CODEX_HOME = codexHome;

const { sourceRegistry } = await import('../src/parsers/index.js');

after(() => rmSync(root, { recursive: true, force: true }));

const ROOTS = { 'kimi-code': kimiRoot, 'claude-code': claudeRoot, codex: codexHome };

function buildTree(sourceId, spec) {
  const base = ROOTS[sourceId];
  for (const file of spec.files) {
    const path = join(base, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${file.lines.map(JSON.stringify).join('\n')}\n`, 'utf8');
  }
  if (spec.sessionIndex) {
    writeFileSync(
      join(base, 'session_index.jsonl'),
      `${spec.sessionIndex.map((entry) => JSON.stringify({
        ...entry,
        sessionDir: entry.sessionDir.replace('@ROOT', base),
      })).join('\n')}\n`,
      'utf8',
    );
  }
}

function aggregate(result) {
  const sumBuckets = (key) => result.buckets.reduce((total, bucket) => total + bucket[key], 0);
  const sumSessions = (key) => result.sessions.reduce((total, session) => total + session[key], 0);
  const totals = {
    buckets: result.buckets.length,
    sessions: result.sessions.length,
    input: sumBuckets('inputTokens'),
    cacheWrite: sumBuckets('cacheWriteInputTokens'),
    cacheRead: sumBuckets('cacheReadInputTokens'),
    output: sumBuckets('outputTokens'),
    reasoning: sumBuckets('reasoningOutputTokens'),
    requests: sumBuckets('requestCount'),
    userMessages: sumSessions('userMessageCount'),
    activeSeconds: sumSessions('activeSeconds'),
  };
  totals.total = totals.input + totals.cacheWrite + totals.cacheRead + totals.output + totals.reasoning;
  return totals;
}

for (const [sourceId, spec] of Object.entries(fixture.sources)) {
  test(`${sourceId} parses the frozen fixture to the frozen aggregate`, async () => {
    buildTree(sourceId, spec);
    const source = sourceRegistry.find((entry) => entry.id === sourceId);
    assert.ok(source, `registry is missing ${sourceId}`);
    const result = await source.parse({ sessionSalt: fixture.sessionSalt });
    assert.deepEqual(aggregate(result), spec.expected);
  });
}
