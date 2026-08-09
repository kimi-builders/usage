import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// KBU_USAGE_CODEX_HOME points at isolated fixtures before import so the
// developer's real ~/.codex can never leak in. Each test re-points the
// override at its own home dir (roots resolve lazily).
const root = mkdtempSync(join(tmpdir(), 'kbu-codex-test-'));
process.env.KBU_USAGE_CODEX_HOME = join(root, 'placeholder');

const { parse } = await import('../src/parsers/codex.js');

const SALT = 'test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

function useHome(name) {
  const home = join(root, name);
  mkdirSync(join(home, 'sessions'), { recursive: true });
  process.env.KBU_USAGE_CODEX_HOME = home;
  return home;
}

function writeRollout(home, tree, name, records) {
  const dir = join(home, tree, '2026', '08', '01');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`, 'utf8');
}

function meta(id, ts, extra = {}) {
  return {
    timestamp: ts,
    type: 'session_meta',
    payload: { id, cwd: '/home/x/demo-api', timestamp: ts, ...extra },
  };
}

function tokenEvent(ts, info) {
  return { timestamp: ts, type: 'event_msg', payload: { type: 'token_count', info } };
}

function usage(input, cached, output, reasoning) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  };
}

function sumTokens(result) {
  const sum = (key) => result.buckets.reduce((total, bucket) => total + bucket[key], 0);
  return {
    input: sum('inputTokens'),
    cacheWrite: sum('cacheWriteInputTokens'),
    cacheRead: sum('cacheReadInputTokens'),
    output: sum('outputTokens'),
    reasoning: sum('reasoningOutputTokens'),
    requests: result.buckets.reduce((total, bucket) => total + bucket.requestCount, 0),
  };
}

test('last_token_usage is preferred over the cumulative total', async () => {
  const home = useHome('last-preferred');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('s1', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', {
      model: 'gpt-5-codex',
      total_token_usage: usage(1000, 100, 100, 10),
      last_token_usage: usage(50, 10, 5, 1),
    }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 40, cacheWrite: 0, cacheRead: 10, output: 4, reasoning: 1, requests: 1,
  });
});

test('cumulative fallback: running baseline plus negative-delta reset', async () => {
  const home = useHome('baseline');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('s1', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { total_token_usage: usage(100, 0, 10, 0) }),
    tokenEvent('2026-08-01T10:03:00.000Z', { total_token_usage: usage(250, 0, 30, 0) }),
    // Counter reset (compaction / new window): the current total is the delta.
    tokenEvent('2026-08-01T10:04:00.000Z', { total_token_usage: usage(60, 0, 5, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 310, cacheWrite: 0, cacheRead: 0, output: 35, reasoning: 0, requests: 3,
  });
});

test('a repeated positive total_tokens is bookkeeping noise and skipped', async () => {
  const home = useHome('bookkeeping');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('s1', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { total_token_usage: usage(100, 0, 10, 0) }),
    tokenEvent('2026-08-01T10:03:00.000Z', { total_token_usage: usage(100, 0, 10, 0) }),
    tokenEvent('2026-08-01T10:04:00.000Z', { total_token_usage: usage(200, 0, 30, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 200, cacheWrite: 0, cacheRead: 0, output: 30, reasoning: 0, requests: 2,
  });
});

test('OpenAI overlapping fields are normalized to exclusive ones', async () => {
  const home = useHome('normalize');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('s1', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(100, 30, 40, 10) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.buckets.length, 1);
  assert.deepEqual(
    {
      input: result.buckets[0].inputTokens,
      cacheWrite: result.buckets[0].cacheWriteInputTokens,
      cacheRead: result.buckets[0].cacheReadInputTokens,
      output: result.buckets[0].outputTokens,
      reasoning: result.buckets[0].reasoningOutputTokens,
    },
    { input: 70, cacheWrite: 0, cacheRead: 30, output: 30, reasoning: 10 },
  );
});

test('GPT-5.6 request context and processing tiers remain separate facts', async () => {
  const home = useHome('pricing-tiers');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('s1', '2026-08-01T10:00:00.000Z'),
    { timestamp: '2026-08-01T10:00:30.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
    tokenEvent('2026-08-01T10:01:00.000Z', {
      model: 'gpt-5.6-sol',
      service_tier: 'priority',
      last_token_usage: usage(300_001, 250_000, 10, 0),
    }),
    tokenEvent('2026-08-01T10:02:00.000Z', {
      model: 'gpt-5.6-sol',
      service_tier: 'standard',
      last_token_usage: usage(200_000, 150_000, 10, 0),
    }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.buckets.length, 2);
  assert.deepEqual(
    result.buckets
      .map((bucket) => [bucket.contextTier, bucket.processingTier, bucket.inputTokens])
      .sort(),
    [
      ['long', 'priority', 50_001],
      ['short', 'standard', 50_000],
    ],
  );
});

test('physical copies of one session keep the file with the most records', async () => {
  const home = useHome('copies');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('shared', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(10, 0, 1, 0) }),
  ]);
  writeRollout(home, 'archived_sessions', 'rollout-b.jsonl', [
    meta('shared', '2026-08-01T10:01:00.000Z'),
    { timestamp: '2026-08-01T10:01:30.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } },
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(100, 0, 10, 0) }),
    tokenEvent('2026-08-01T10:03:00.000Z', { last_token_usage: usage(200, 0, 20, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 300, cacheWrite: 0, cacheRead: 0, output: 30, reasoning: 0, requests: 2,
  });
});

test('forked child replays the parent prefix with fresh timestamps: only new usage counts', async () => {
  const home = useHome('fork');
  const e1 = { model: 'gpt-5-codex', total_token_usage: usage(100, 0, 10, 0), last_token_usage: usage(100, 0, 10, 0) };
  const e2 = { model: 'gpt-5-codex', total_token_usage: usage(200, 0, 20, 0), last_token_usage: usage(100, 0, 10, 0) };
  writeRollout(home, 'sessions', 'rollout-parent.jsonl', [
    meta('parent', '2026-08-01T10:00:00.000Z'),
    { timestamp: '2026-08-01T10:01:00.000Z', type: 'turn_context', payload: { model: 'gpt-5-codex' } },
    tokenEvent('2026-08-01T10:03:00.000Z', e1),
    tokenEvent('2026-08-01T10:04:00.000Z', e2),
  ]);
  writeRollout(home, 'sessions', 'rollout-child.jsonl', [
    meta('child', '2026-08-01T10:10:00.000Z', { forked_from_id: 'parent' }),
    // Replayed parent history: same payloads, fresh outer timestamps.
    tokenEvent('2026-08-01T10:11:00.000Z', e1),
    tokenEvent('2026-08-01T10:12:00.000Z', e2),
    tokenEvent('2026-08-01T10:13:00.000Z', { last_token_usage: usage(7, 0, 3, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  // parent 100+100 input / 10+10 output + child 7/3 — the replayed prefix
  // would wrongly add another 200/20 if it were not skipped.
  assert.deepEqual(sumTokens(result), {
    input: 207, cacheWrite: 0, cacheRead: 0, output: 23, reasoning: 0, requests: 3,
  });
  assert.equal(result.sessions.length, 2);
  const childHash = createHmac('sha256', SALT).update('child').digest('hex');
  const child = result.sessions.find((session) => session.sessionHash === childHash);
  // Replayed records are also excluded from session timing.
  assert.equal(child.messageCount, 2);
  assert.equal(child.userMessageCount, 1);
});

test('sub-agent markers: thread_source fails open, source.subagent finds the parent', async () => {
  const home = useHome('subagent');
  const e1 = { last_token_usage: usage(50, 0, 5, 0) };
  writeRollout(home, 'sessions', 'rollout-parent.jsonl', [
    meta('parent', '2026-08-01T10:00:00.000Z'),
    tokenEvent('2026-08-01T10:00:30.000Z', e1),
  ]);
  // thread_source: 'subagent' but no parent id anywhere → fail open, count all.
  writeRollout(home, 'sessions', 'rollout-sub1.jsonl', [
    meta('sub1', '2026-08-01T10:01:00.000Z', { thread_source: 'subagent' }),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(5, 0, 1, 0) }),
  ]);
  // source.subagent.thread_spawn.parent_thread_id → replay prefix skipped.
  writeRollout(home, 'sessions', 'rollout-sub2.jsonl', [
    meta('sub2', '2026-08-01T10:01:00.000Z', {
      source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } },
    }),
    tokenEvent('2026-08-01T10:02:00.000Z', e1),
    tokenEvent('2026-08-01T10:03:00.000Z', { last_token_usage: usage(9, 0, 2, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 64, cacheWrite: 0, cacheRead: 0, output: 8, reasoning: 0, requests: 3,
  });
  assert.equal(result.sessions.length, 3);
});

test('only the first session_meta is canonical (id, project, timing)', async () => {
  const home = useHome('first-meta');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('real-id', '2026-08-01T10:00:00.000Z', { cwd: '/x/first-proj' }),
    meta('copied-parent', '2026-08-01T10:00:30.000Z', { cwd: '/y/other' }),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(3, 0, 1, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.sessions.length, 1);
  const expectedHash = createHmac('sha256', SALT).update('real-id').digest('hex');
  assert.equal(result.sessions[0].sessionHash, expectedHash);
  assert.equal(result.sessions[0].project, 'first-proj');
  // The copied parent meta is excluded from timing events.
  assert.equal(result.sessions[0].messageCount, 2);
});

test('turn_context model is sticky; info.model overrides it', async () => {
  const home = useHome('sticky');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    meta('s1', '2026-08-01T10:00:00.000Z', {
      cli_version: '0.146.1',
      model_provider: 'openai',
    }),
    { timestamp: '2026-08-01T10:01:00.000Z', type: 'turn_context', payload: { model: 'gpt-a', effort: 'high' } },
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(1, 0, 1, 0) }),
    { timestamp: '2026-08-01T10:03:00.000Z', type: 'turn_context', payload: { model: 'gpt-b', effort: 'max' } },
    tokenEvent('2026-08-01T10:04:00.000Z', { last_token_usage: usage(2, 0, 2, 0) }),
    tokenEvent('2026-08-01T10:05:00.000Z', { model: 'gpt-c', last_token_usage: usage(4, 0, 1, 0) }),
    { timestamp: '2026-08-01T10:06:00.000Z', type: 'turn_context', payload: { model: 'gpt-d' } },
    tokenEvent('2026-08-01T10:07:00.000Z', { last_token_usage: usage(8, 0, 1, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  const byModel = Object.fromEntries(result.buckets.map((bucket) => [bucket.model, bucket.inputTokens]));
  assert.deepEqual(byModel, { 'gpt-a': 1, 'gpt-b': 2, 'gpt-c': 4, 'gpt-d': 8 });
  assert.deepEqual(
    Object.fromEntries(result.buckets.map((bucket) => [bucket.model, bucket.reasoningEffort])),
    { 'gpt-a': 'high', 'gpt-b': 'max', 'gpt-c': 'max', 'gpt-d': undefined },
  );
  assert.ok(result.buckets.every((bucket) => bucket.modelProvider === 'openai'));
  assert.ok(result.buckets.every((bucket) => bucket.agentVersion === '0.146.1'));
  assert.equal(result.sessions[0].agentVersion, '0.146.1');
});

test('corrupt lines are skipped; an empty home parses to zero items', async () => {
  const home = useHome('messy');
  writeRollout(home, 'sessions', 'rollout-a.jsonl', [
    'garbage, not json',
    meta('s1', '2026-08-01T10:00:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(3, 0, 1, 0) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 3, cacheWrite: 0, cacheRead: 0, output: 1, reasoning: 0, requests: 1,
  });

  const empty = useHome('empty');
  const emptyResult = await parse({ sessionSalt: SALT });
  assert.deepEqual(emptyResult, { buckets: [], sessions: [] });
  assert.ok(empty);
});
