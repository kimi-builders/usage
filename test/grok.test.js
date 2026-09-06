import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '../src/parsers/grok.js';

const SALT = 'grok-session-salt'.padEnd(32, 'x');

test('Grok CLI parses turn_completed model usage and subtracts overlapping fields', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kbu-grok-'));
  const path = join(home, 'sessions', encodeURIComponent('/work/grok-demo'), 'session-1');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'summary.json'), JSON.stringify({ info: { cwd: '/work/grok-demo' }, current_model_id: 'grok-4.5' }));
  writeFileSync(join(path, 'updates.jsonl'), [
    { timestamp: 1784168190, params: { update: { sessionUpdate: 'user_message_chunk' } } },
    { timestamp: 1784168200, params: { update: { sessionUpdate: 'turn_completed', usage: {
      modelUsage: { 'grok-4.5': { inputTokens: 100, cachedReadTokens: 40, outputTokens: 30, reasoningTokens: 5, modelCalls: 2 } },
    } } } },
  ].map(JSON.stringify).join('\n'));
  const previous = process.env.GROK_HOME;
  const previousSessions = process.env.KBU_USAGE_GROK_SESSIONS;
  process.env.GROK_HOME = home;
  delete process.env.KBU_USAGE_GROK_SESSIONS;
  try {
    const result = await parse({ sessionSalt: SALT });
    assert.equal(result.buckets[0].inputTokens, 60);
    assert.equal(result.buckets[0].cacheReadInputTokens, 40);
    assert.equal(result.buckets[0].outputTokens, 25);
    assert.equal(result.buckets[0].reasoningOutputTokens, 5);
    assert.equal(result.buckets[0].requestCount, 2);
    assert.equal(result.sessions[0].project, 'grok-demo');
  } finally {
    if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous;
    if (previousSessions === undefined) delete process.env.KBU_USAGE_GROK_SESSIONS; else process.env.KBU_USAGE_GROK_SESSIONS = previousSessions;
    rmSync(home, { recursive: true, force: true });
  }
});
