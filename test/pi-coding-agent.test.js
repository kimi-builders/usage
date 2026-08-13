import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kbu-pi-test-'));
process.env.KBU_USAGE_PI_SESSION_DIRS = join(root, 'absent');
const { parse, roots } = await import('../src/parsers/pi-coding-agent.js');
const SALT = 'pi-test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

function writeSession(dir, fileName = 'session.jsonl') {
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'session', id: 'pi-session', timestamp: '2026-08-10T10:00:00.000Z', cwd: '/private/work/pi-project' },
    { type: 'message', id: 'user-1', timestamp: '2026-08-10T10:00:01.000Z', message: { role: 'user', content: 'PRIVATE_PROMPT' } },
    { type: 'message', id: 'assistant-1', timestamp: '2026-08-10T10:00:06.000Z', message: {
      role: 'assistant', model: 'pi-model', provider: 'test-provider', content: 'PRIVATE_RESPONSE',
      usage: { input: 100, cacheWrite: 10, cacheRead: 30, output: 20, reasoningTokens: 4 },
    } },
  ];
  writeFileSync(join(dir, fileName), lines.map(JSON.stringify).join('\n') + '\n');
}

test('missing Pi store reports not installed', async () => {
  assert.deepEqual(roots(), []);
  assert.equal(await parse({ sessionSalt: SALT }), null);
});

test('Pi preserves exclusive cache and reasoning fields, deduplicates copied records, and hashes sessions', async () => {
  const first = join(root, 'first');
  const second = join(root, 'second');
  writeSession(first);
  writeSession(second);
  process.env.KBU_USAGE_PI_SESSION_DIRS = [first, second].join(delimiter);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.buckets.length, 1);
  assert.deepEqual(result.buckets[0], {
    source: 'pi-coding-agent',
    model: 'pi-model',
    modelProvider: 'test-provider',
    project: 'pi-project',
    bucketStart: '2026-08-10T10:00:00.000Z',
    inputTokens: 100,
    cacheWriteInputTokens: 10,
    cacheReadInputTokens: 30,
    outputTokens: 16,
    reasoningOutputTokens: 4,
    requestCount: 1,
    measurement: 'exact',
  });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionHash.length, 64);
  assert.equal(result.sessions[0].userMessageCount, 1);
  assert.equal(result.sessions[0].messageCount, 2);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE_'), false);
  assert.equal(serialized.includes('/private/work'), false);
});
