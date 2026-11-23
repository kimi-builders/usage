import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '../src/parsers/codex.js';
import { compactCodexUsage } from '../src/parsers/codex-usage.js';

const root = mkdtempSync(join(tmpdir(), 'kbu-codex-durable-'));
process.env.KBU_USAGE_CODEX_HOME = root;
after(() => rmSync(root, { recursive: true, force: true }));
const salt = 'fixture-salt'.padEnd(32, 'x');
const stamp = (second) => new Date(Date.UTC(2026, 9, 8, 10, 0, second)).toISOString();
const usage = (input = 100, output = 10, cached = 20, reasoning = 2) => ({
  input_tokens: input, output_tokens: output, cached_input_tokens: cached,
  reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const meta = (id = 'thread', extra = {}) => ({ timestamp: stamp(0), type: 'session_meta', payload: { id, cwd: '/fixture/project', ...extra } });
const context = (turn = 'turn') => ({ timestamp: stamp(0), type: 'turn_context', payload: { turn_id: turn, model: 'gpt-5.6-sol' } });
const ledger = (id = 'one', second = 1, total = usage(), delta = usage(), extra = {}) => ({
  timestamp: stamp(second), type: 'token_usage_record',
  payload: { thread_id: 'thread', session_id: 'thread', turn_id: 'turn', response_id: id, usage: delta, thread_token_usage: total, ...extra },
});
const legacy = (second = 1, total = usage(), delta = usage()) => ({ timestamp: stamp(second), type: 'event_msg',
  payload: { type: 'token_count', info: { last_token_usage: delta, total_token_usage: total } } });
let sequence = 0;
const encoded = (rows) => rows.map(JSON.stringify).join('\n') + '\n';
function fixture(rows) {
  const home = join(root, String(sequence++));
  mkdirSync(join(home, 'sessions'), { recursive: true });
  const path = join(home, 'sessions', 'rollout.jsonl');
  writeFileSync(path, encoded(rows));
  process.env.KBU_USAGE_CODEX_HOME = home;
  return { home, path, run: () => parse({ sessionSalt: salt }) };
}
const total = (result, field = 'inputTokens') => result.buckets.reduce((sum, row) => sum + row[field], 0);

test('Codex durable-only records recover interrupted requests with exclusive fields and one timing event', async () => {
  const result = await fixture([meta(), context(), ledger()]).run();
  assert.equal(total(result), 80);
  assert.equal(total(result, 'cacheReadInputTokens'), 20);
  assert.equal(total(result, 'outputTokens'), 8);
  assert.equal(total(result, 'reasoningOutputTokens'), 2);
  assert.equal(total(result, 'requestCount'), 1);
  assert.equal(result.buckets[0].model, 'gpt-5.6-sol');
  assert.equal(result.sessions[0].messageCount, 3);
});

test('Codex reconciliation preserves numeric millisecond timestamps accepted by legacy rollouts', async () => {
  for (const record of [ledger(), legacy()]) {
    record.timestamp = Date.parse(stamp(1));
    const result = await fixture([meta(), context(), record]).run();
    assert.equal(total(result), 80);
    assert.equal(total(result, 'requestCount'), 1);
    assert.equal(result.buckets[0].bucketStart, '2026-10-08T10:00:00.000Z');
  }
});

test('Codex pairs both mirror orders, including lagging UI counters and missing legacy ids', async () => {
  for (const first of ['ledger', 'legacy']) {
    for (const counter of [usage(), usage(90, 10, 20, 2)]) {
      const rows = first === 'ledger' ? [ledger(), legacy(2, counter)] : [legacy(1, counter), ledger('one', 2)];
      const result = await fixture([meta(), context(), ...rows]).run();
      assert.equal(total(result), 80, `${first} ${JSON.stringify(counter)}`);
      assert.equal(total(result, 'requestCount'), 1);
      assert.equal(result.sessions[0].messageCount, 3);
    }
  }
});

test('same-sized distinct Codex requests are never collapsed just because their records are adjacent', async () => {
  const result = await fixture([meta(), context(), ledger(), ledger('two', 2, usage(200, 20, 40, 4)),
    legacy(3, usage(300, 30, 60, 6)),
  ]).run();
  assert.equal(total(result), 240);
  assert.equal(total(result, 'requestCount'), 3);
});

test('Codex UI totals may lag entire interrupted calls or belong to a resumed cumulative domain', async () => {
  const interrupted = await fixture([meta(), context(), ledger(),
    ledger('two', 3, usage(200, 20, 40, 4)), legacy(4),
  ]).run();
  assert.equal(total(interrupted), 160);
  assert.equal(total(interrupted, 'requestCount'), 2);
  for (const legacyFirst of [false, true]) {
    const durable = ledger('one', legacyFirst ? 2 : 1, usage(3000, 300, 600, 60), usage(1000, 100, 200, 20));
    const ui = legacy(legacyFirst ? 1 : 2, usage(1500, 150, 300, 30), usage(1000, 100, 200, 20));
    const result = await fixture([meta(), context(), ...(legacyFirst ? [ui, durable] : [durable, ui])]).run();
    assert.equal(total(result), 800);
    assert.equal(total(result, 'requestCount'), 1);
  }
});

test('Codex near-mirror matching retains evidence of intervening requests and legacy-first counter advance', async () => {
  const first = await fixture([meta(), context(), legacy(), ledger('two', 2, usage(200, 20, 40, 4))]).run();
  assert.equal(total(first, 'requestCount'), 2);
  const result = await fixture([meta(), context(),
    ledger('one', 1, usage(1100, 110, 220, 22)), legacy(1),
    ledger('two', 2, usage(1200, 120, 240, 24)),
    legacy(3, usage(300, 30, 60, 6)), // legacy advanced by two requests, not one mirror
  ]).run();
  assert.equal(total(result), 240);
  assert.equal(total(result, 'requestCount'), 3);
});

test('delayed UI mirrors with larger cumulative totals still count once when both streams advance by this call', async () => {
  const base = ledger('base', 1);
  const ui = legacy(1, usage(500, 50, 100, 10));
  const call = ledger('next', 5, usage(200, 20, 40, 4));
  const mirror = legacy(45, usage(600, 60, 120, 12));
  const result = await fixture([meta(), context(), base, ui, call, mirror]).run();
  assert.equal(total(result, 'requestCount'), 2);
  assert.equal(total(result), 160);
});

test('child drops copied UI before its own task even without parent; an owned ledger is not a copied prefix', async () => {
  const child = meta('child', { parent_thread_id: 'missing', timestamp: stamp(20) });
  const task = { type: 'event_msg', timestamp: stamp(20), payload: { type: 'turn_started', started_at: Date.parse(stamp(20)) } };
  const owned = ledger('response', 22, usage(), usage(), { thread_id: 'child', session_id: 'child' });
  const result = await fixture([child, meta('missing'), legacy(2), task, owned]).run();
  assert.equal(total(result, 'requestCount'), 1);
  const early = await fixture([child, owned, task]).run();
  assert.equal(total(early, 'requestCount'), 1);
});

test('new Codex response identities survive repeated/reset totals; replayed identities and mirrors count once', async () => {
  for (const legacyFirst of [false, true]) {
    const mirror = legacy(3, usage(200, 20, 40, 4));
    const copy = ledger('one', 3, usage(200, 20, 40, 4));
    const result = await fixture([meta(), context(), ledger(),
      ...(legacyFirst ? [mirror, copy] : [copy, mirror]),
      ledger('two', 4, usage()), legacy(4),
    ]).run();
    assert.equal(total(result), 160);
    assert.equal(total(result, 'requestCount'), 2);
  }
});

test('Codex thread and legacy cumulative baselines remain independent across a resumed counter reset', async () => {
  const next = usage(60, 6, 20, 3);
  const threadTotal = usage(1060, 106, 220, 43);
  const result = await fixture([meta(), context(), ledger('one', 1, usage(1000, 100, 200, 40), usage(1000, 100, 200, 40)),
    legacy(1, usage(1000, 100, 200, 40), usage(1000, 100, 200, 40)),
    ledger('two', 2, threadTotal, next, { turn_token_usage: next }), legacy(3, next, next),
    legacy(4, usage(90, 9, 30, 4), null),
  ]).run();
  assert.equal(total(result), 860);
  assert.equal(total(result, 'requestCount'), 3);
});

test('Codex append then rescan reconciles a delayed mirror without changing the original day', async () => {
  const record = ledger(); record.timestamp = '2026-10-08T23:59:59Z';
  const file = fixture([meta(), context(), record]);
  assert.equal(total(await file.run()), 80);
  const mirror = legacy(); mirror.timestamp = '2026-10-09T00:00:01Z';
  appendFileSync(file.path, encoded([mirror]));
  const result = await file.run();
  assert.equal(total(result), 80);
  assert.ok(result.buckets[0].bucketStart.startsWith('2026-10-08'));
  assert.deepEqual(await file.run(), result);
});

test('Codex older durable shapes without identities remain supported and duplicate totals count once', async () => {
  const record = ledger();
  for (const key of ['thread_id', 'session_id', 'response_id', 'turn_id']) delete record.payload[key];
  const result = await fixture([meta(), context(), record, legacy(2), { ...record, timestamp: stamp(3) }]).run();
  assert.equal(total(result), 80);
  assert.equal(total(result, 'requestCount'), 1);
});

test('Codex mirrors retain service tier metadata and separate cached writes', async () => {
  const delta = { ...usage(300_001, 10, 200_000, 2), cache_write_input_tokens: 100 };
  const ui = legacy(2, delta, delta); ui.payload.info.service_tier = 'priority';
  const result = await fixture([meta(), context(), ledger('one', 1, delta, delta), ui]).run();
  assert.equal(total(result), 99_901);
  assert.equal(total(result, 'cacheWriteInputTokens'), 100);
  assert.equal(result.buckets[0].contextTier, 'long');
  assert.equal(result.buckets[0].processingTier, 'priority');
});

test('invalid durable accounting marks partial, never suppresses valid legacy usage, and exports no payloads', async () => {
  for (const patch of [
    { input_tokens: -1 }, { input_tokens: '100' }, { input_tokens: true },
    { output_tokens: null }, { input_tokens: Number.MAX_SAFE_INTEGER },
    { cached_input_tokens: 101 }, { reasoning_output_tokens: 11 }, { total_tokens: Infinity },
  ]) {
    const record = ledger(); record.payload.usage = { ...usage(), ...patch, prompt: 'PRIVATE SENTINEL' };
    const result = await fixture([meta(), context(), record, legacy(2)]).run();
    assert.equal(total(result), 80, JSON.stringify(patch));
    assert.equal(result.skipped, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE SENTINEL|response_id|thread_id/);
  }
  const compact = compactCodexUsage({ ...ledger(), payload: { ...ledger().payload, prompt: 'PRIVATE',
    usage: { ...usage(), input_tokens: { content: 'PRIVATE' }, tool_output: 'PRIVATE' } } });
  assert.doesNotMatch(JSON.stringify(compact), /PRIVATE|tool_output|prompt/);
});

test('a malformed durable event breaks pending mirror matching instead of erasing the next real legacy request', async () => {
  const invalid = ledger('invalid', 2); invalid.payload.usage = { input_tokens: -1 };
  const result = await fixture([meta(), context(), ledger(), invalid, legacy(3)]).run();
  assert.equal(total(result), 160);
  assert.equal(result.skipped, true);
});

test('foreign thread and execution-session ledger rows do not count even when the parent is absent', async () => {
  for (const ownership of [{ thread_id: 'parent', session_id: 'parent' }, { session_id: 'different-execution' }]) {
    const result = await fixture([meta(), context(), ledger('foreign', 1, usage(), usage(), ownership), legacy(2)]).run();
    assert.equal(total(result), 0);
    assert.equal(result.skipped, undefined);
  }
  const result = await fixture([meta('thread', { session_id: 'execution' }), context(),
    ledger('one', 1, usage(), usage(), { session_id: 'execution' }), legacy(2),
  ]).run();
  assert.equal(total(result), 80);
});

test('Codex owned request ids are scoped per thread, including physical copies', async () => {
  const file = fixture([meta(), context(), ledger()]);
  mkdirSync(join(file.home, 'archived_sessions'), { recursive: true });
  writeFileSync(join(file.home, 'archived_sessions', 'copy.jsonl'), encoded([meta(), context(), ledger()]));
  writeFileSync(join(file.home, 'sessions', 'other.jsonl'), encoded([meta('other'), context(),
    ledger('one', 1, usage(), usage(), { thread_id: 'other', session_id: 'other' }),
  ]));
  const result = await file.run();
  assert.equal(total(result), 160);
  assert.equal(result.sessions.length, 2);
});

test('anonymous durable fork replay preserves the existing longest-prefix accounting', async () => {
  const record = ledger();
  for (const key of ['thread_id', 'session_id', 'response_id', 'turn_id']) delete record.payload[key];
  const file = fixture([meta(), record]);
  writeFileSync(join(file.home, 'sessions', 'child.jsonl'), encoded([
    { ...meta('child', { forked_from_id: 'thread', timestamp: stamp(5) }), timestamp: stamp(5) },
    { ...record, timestamp: stamp(6) },
    legacy(7, usage(200, 20, 40, 4)),
  ]));
  const result = await file.run();
  assert.equal(total(result), 160);
  assert.equal(total(result, 'requestCount'), 2);
});

test('same-valued records across turn boundaries or distant timestamps are not treated as near mirrors', async () => {
  const result = await fixture([meta(), context(), ledger(), context('other'), legacy(2, usage(90)),
    ledger('two', 10, usage(200, 20, 40, 4), usage(), { turn_id: 'other' }), legacy(100, usage(190, 20, 40, 4)),
  ]).run();
  assert.equal(total(result), 320);
  assert.equal(total(result, 'requestCount'), 4);
});
