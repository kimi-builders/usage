import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kbu-roo-test-'));
process.env.KBU_USAGE_ROO_DIRS = root;
const { parse } = await import('../src/parsers/roo-code.js');

after(() => rmSync(root, { recursive: true, force: true }));

test('Roo Code reads task history, exact cache fields, and timing events', async () => {
  const taskDir = join(root, 'tasks', 'task-1');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(root, 'tasks', '_index.json'), JSON.stringify({ entries: [{
    id: 'task-1',
    workspace: '/Users/x/demo',
    apiConfigName: 'fallback-profile',
  }] }), 'utf8');
  writeFileSync(join(taskDir, 'ui_messages.json'), JSON.stringify([
    { type: 'ask', ts: Date.parse('2026-08-01T10:01:00.000Z') },
    {
      type: 'say',
      say: 'api_req_started',
      ts: Date.parse('2026-08-01T10:02:00.000Z'),
      text: JSON.stringify({ model: 'claude-sonnet-4', tokensIn: 40, tokensOut: 10, cacheWrites: 12, cacheReads: 30 }),
    },
  ]), 'utf8');

  const result = await parse({ sessionSalt: 'test-session-salt'.padEnd(32, 'x') });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.buckets[0].project, 'demo');
  assert.deepEqual(
    {
      input: result.buckets[0].inputTokens,
      cacheWrite: result.buckets[0].cacheWriteInputTokens,
      cacheRead: result.buckets[0].cacheReadInputTokens,
      output: result.buckets[0].outputTokens,
    },
    { input: 40, cacheWrite: 12, cacheRead: 30, output: 10 },
  );
});
