import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, selectTraeUsageSpans } from '../src/parsers/trae-cli.js';

const SALT = 'trae-session-salt'.padEnd(32, 'x');

test('Trae CLI keeps the authoritative span and exact cache/reasoning fields', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-trae-'));
  const session = join(directory, 'session-1');
  mkdirSync(session, { recursive: true });
  writeFileSync(join(session, 'session.json'), JSON.stringify({ metadata: { cwd: '/work/demo', model_name: 'GLM-5.3' } }));
  const span = (category) => JSON.stringify({ startTime: 1783429023825200, tags: [
    { key: 'span.category', value: category }, { key: 'model.name', value: 'GLM-5.3' },
    { key: 'usage.input_tokens', value: 100 }, { key: 'usage.output_tokens', value: 20 },
    { key: 'usage.cache_read_tokens', value: 50 }, { key: 'usage.reasoning_tokens', value: 4 },
  ] });
  writeFileSync(join(session, 'traces.jsonl'), `${span('model.stream.eino')}\n${span('model.real_call')}\n`);
  writeFileSync(join(session, 'events.jsonl'), `${JSON.stringify({ created_at: '2026-07-07T12:57:03Z', agent_start: {} })}\n${JSON.stringify({ created_at: '2026-07-07T12:57:04Z', agent_end: {} })}\n`);
  const previous = process.env.KBU_USAGE_TRAE_CLI_SESSIONS;
  process.env.KBU_USAGE_TRAE_CLI_SESSIONS = directory;
  try {
    const result = await parse({ sessionSalt: SALT });
    assert.equal(result.buckets.length, 1);
    assert.equal(result.buckets[0].inputTokens, 50);
    assert.equal(result.buckets[0].cacheReadInputTokens, 50);
    assert.equal(result.buckets[0].outputTokens, 16);
    assert.equal(result.buckets[0].reasoningOutputTokens, 4);
    assert.equal(result.sessions[0].project, 'demo');
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_TRAE_CLI_SESSIONS;
    else process.env.KBU_USAGE_TRAE_CLI_SESSIONS = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Trae span selection retains failovers and drops duplicate layers', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, reasoningOutputTokens: 0 };
  const selected = selectTraeUsageSpans([
    { category: 'model.stream.eino', usage }, { category: 'model.real_call', usage },
    { category: 'model.generate', usage },
  ]);
  assert.deepEqual(selected.map((span) => span.category), ['model.stream.eino', 'model.generate']);
});
