import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kbu-copilot-test-'));
process.env.KBU_USAGE_COPILOT_DIR = root;
const { parse, roots } = await import('../src/parsers/copilot-cli.js');
const salt = 'test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

test('Copilot CLI reads sessions and splits cache input into exclusive fields', async () => {
  const sessionDir = join(root, 'session-1');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'events.jsonl'), `${[
    { type: 'session.start', timestamp: '2026-08-01T10:00:00.000Z', data: { context: { gitRoot: '/Users/x/demo' } } },
    { type: 'user.message', timestamp: '2026-08-01T10:01:00.000Z' },
    { type: 'assistant.message', timestamp: '2026-08-01T10:02:00.000Z' },
    { type: 'session.shutdown', timestamp: '2026-08-01T10:03:00.000Z', data: { modelMetrics: {
      'gpt-5': { usage: { inputTokens: 100, cacheReadTokens: 30, cacheWriteTokens: 20, outputTokens: 10 } },
    } } },
  ].map(JSON.stringify).join('\n')}\n`, 'utf8');

  assert.deepEqual(roots(), [root]);
  const result = await parse({ sessionSalt: salt });
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(
    {
      input: result.buckets[0].inputTokens,
      cacheWrite: result.buckets[0].cacheWriteInputTokens,
      cacheRead: result.buckets[0].cacheReadInputTokens,
      output: result.buckets[0].outputTokens,
    },
    { input: 50, cacheWrite: 20, cacheRead: 30, output: 10 },
  );
});
