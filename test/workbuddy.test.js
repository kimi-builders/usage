import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kbu-workbuddy-test-'));
process.env.KBU_USAGE_WORKBUDDY_DIRS = join(root, 'absent');
const { parse, roots } = await import('../src/parsers/workbuddy.js');
const SALT = 'workbuddy-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

function record(id, sessionId, model, timestamp) {
  return {
    id, sessionId, timestamp, type: 'message', role: 'assistant', status: 'completed',
    cwd: '/private/repo/workbuddy-project', content: 'PRIVATE_RESPONSE',
    message: { role: 'assistant' },
    providerData: {
      requestModelId: model, provider: 'router',
      usage: { inputTokens: 100, outputTokens: 20,
        inputTokensDetails: [{ cached_tokens: 40 }],
        outputTokensDetails: [{ reasoning_tokens: 5 }] },
    },
  };
}

test('missing WorkBuddy projects store reports not installed', async () => {
  assert.deepEqual(roots(), []);
  assert.equal(await parse({ sessionSalt: SALT }), null);
});

test('WorkBuddy keeps routed models, exclusive tokens, per-session dedup, and no content', async () => {
  const projects = join(root, 'workbuddy', 'projects', 'encoded');
  mkdirSync(projects, { recursive: true });
  const lines = [];
  for (const [sessionId, minute, model] of [['a', '00', 'hy3'], ['b', '10', 'auto-routed']]) {
    lines.push({ id: 'shared-user', sessionId, timestamp: `2026-08-10T10:${minute}:00.000Z`,
      type: 'message', role: 'user', cwd: '/private/repo/workbuddy-project', content: 'PRIVATE_PROMPT' });
    lines.push(record('shared-request', sessionId, model, `2026-08-10T10:${minute}:10.000Z`));
  }
  writeFileSync(join(projects, 'sessions.jsonl'), lines.map(JSON.stringify).join('\n') + '\n');
  process.env.KBU_USAGE_WORKBUDDY_DIRS = join(root, 'workbuddy');
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.buckets.length, 2);
  assert.deepEqual(new Set(result.buckets.map((bucket) => bucket.model)), new Set(['hy3', 'auto-routed']));
  for (const bucket of result.buckets) {
    assert.equal(bucket.inputTokens, 60);
    assert.equal(bucket.cacheReadInputTokens, 40);
    assert.equal(bucket.outputTokens, 15);
    assert.equal(bucket.reasoningOutputTokens, 5);
    assert.equal(bucket.modelProvider, 'router');
    assert.equal(bucket.requestCount, 1);
  }
  assert.equal(result.sessions.length, 2);
  assert.deepEqual(result.sessions.map((session) => session.messageCount), [2, 2]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE_'), false);
  assert.equal(serialized.includes('/private/repo'), false);
});
