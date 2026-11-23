import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
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

test('rollouts are streamed instead of becoming one V8-sized string', () => {
  const source = readFileSync(new URL('../src/parsers/codex.js', import.meta.url), 'utf8');
  assert.match(source, /createReadStream/);
  assert.doesNotMatch(source, /\breadFileSync\b/);
});

// Small single-segment Zstd frame with a raw block. Tests can generate it
// even on Node 20, where the reader uses the optional system zstd binary.
function rawFrame(data) {
  assert.ok(data.length < 256);
  const head = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, data.length, 0, 0, 0]);
  head.writeUIntLE((data.length << 3) | 1, 6, 3);
  return Buffer.concat([head, data]);
}
const canDecode = typeof zlib.createZstdDecompress === 'function' || spawnSync('zstd', ['--version']).status === 0;
test('compressed frames spanning UTF-8 and JSON boundaries reproduce plain usage and session identity', { skip: !canDecode }, async () => {
  const home = useHome('zstd-equivalence');
  const call = tokenEvent('2026-11-22T12:00:00Z', { model: '网关/gpt-6.2-sol', last_token_usage: usage(100, 80, 10, 3) });
  const data = Buffer.from(JSON.stringify(call) + '\n');
  const plain = join(home, 'sessions', 'no-meta.jsonl');
  writeFileSync(plain, data);
  const expected = await parse({ sessionSalt: SALT });
  const split = data.indexOf(Buffer.from('网')) + 1;
  const archive = join(home, 'archived_sessions', 'no-meta.jsonl.zst');
  mkdirSync(join(home, 'archived_sessions'), { recursive: true });
  const skippedFrame = Buffer.from([0x50, 0x2a, 0x4d, 0x18, 0, 0, 0, 0]);
  writeFileSync(archive, Buffer.concat([rawFrame(data.subarray(0, split)), skippedFrame, rawFrame(data.subarray(split))]));
  assert.deepEqual(await parse({ sessionSalt: SALT }), expected); // coexistence
  rmSync(plain);
  assert.deepEqual(await parse({ sessionSalt: SALT }), expected); // compression-only
});

test('a broken archive discards its decoded prefix, keeps healthy logs and marks Codex partial', async () => {
  const home = useHome('zstd-broken');
  const row = tokenEvent('2026-11-22T12:00:00Z', { last_token_usage: usage(20, 4, 2, 0) });
  writeRollout(home, 'sessions', 'healthy.jsonl', [row]);
  const frame = rawFrame(Buffer.from(JSON.stringify(row) + '\n'));
  writeFileSync(join(home, 'sessions', 'broken.jsonl.zst'), Buffer.concat([frame, frame.subarray(0, -1)]));
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.skipped, true);
  assert.match(result.warnings.join(' '), /compressed rollout/);
  assert.equal(sumTokens(result).requests, 1);
});

test('without native Zstd the system decoder works if installed; otherwise the archive is partial, not zero usage', async () => {
  const home = useHome('no-native-zstd');
  const frame = rawFrame(Buffer.from(JSON.stringify(tokenEvent('2026-11-22T12:00:00Z', { last_token_usage: usage(12, 0, 2, 0) }))));
  writeFileSync(join(home, 'sessions', 'only.jsonl.zst'), frame);
  const prop = Object.getOwnPropertyDescriptor(zlib, 'createZstdDecompress');
  const path = process.env.PATH;
  try {
    if (prop) Object.defineProperty(zlib, 'createZstdDecompress', { ...prop, value: undefined });
    if (spawnSync('zstd', ['--version']).status === 0) {
      assert.equal(sumTokens(await parse({ sessionSalt: SALT })).requests, 1);
    }
    process.env.PATH = home;
    const result = await parse({ sessionSalt: SALT });
    assert.equal(result.skipped, true);
    assert.equal(result.buckets.length, 0);
    assert.match(result.warnings[0], /zstd/);
  } finally {
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
    if (prop) Object.defineProperty(zlib, 'createZstdDecompress', prop);
  }
});

test('thread settings and turn context label subsequent requests; an explicit request tier wins', async () => {
  const home = useHome('routed-model-settings');
  const ts = '2026-11-22T12:00:00Z';
  const row = (service_tier) => tokenEvent(ts, { service_tier, last_token_usage: usage(30, 5, 3, 0) });
  writeRollout(home, 'sessions', 'settings.jsonl', [meta('fixture', ts),
    { type: 'event_msg', timestamp: ts, payload: { type: 'thread_settings_applied', thread_settings: { model: 'ABC/gpt-6.2-sol', service_tier: 'fast' } } },
    row(), row('standard'),
    { type: 'turn_context', timestamp: ts, payload: { model: 'gpt-6.2-astra', service_tier: null } }, row(),
  ]);
  assert.deepEqual((await parse({ sessionSalt: SALT })).buckets.map(b => [b.model, b.processingTier || '', b.requestCount]), [
    ['ABC/gpt-6.2-sol', 'priority', 1], ['ABC/gpt-6.2-sol', 'standard', 1], ['gpt-6.2-astra', '', 1],
  ]);
});

test('large irrelevant payloads are compacted without losing timing or token facts', async () => {
  const home = useHome('large-record');
  writeRollout(home, 'sessions', 'rollout-large.jsonl', [
    meta('large', '2026-08-01T10:00:00.000Z'),
    { timestamp: '2026-08-01T10:01:00.000Z', type: 'response_item', payload: { body: 'x'.repeat(2 * 1024 * 1024) } },
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(9, 3, 2, 1) }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 6, cacheWrite: 0, cacheRead: 3, output: 1, reasoning: 1, requests: 1,
  });
  assert.equal(result.sessions[0].messageCount, 3);
});

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

test('official OpenAI long-context thresholds remain separate from processing tiers', async () => {
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
    tokenEvent('2026-08-01T10:03:00.000Z', {
      model: 'openai/gpt-6-astra',
      service_tier: 'standard',
      last_token_usage: usage(272_001, 200_000, 10, 0),
    }),
  ]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.buckets.length, 3);
  assert.deepEqual(
    result.buckets
      .map((bucket) => [bucket.model, bucket.contextTier, bucket.processingTier, bucket.inputTokens])
      .sort(),
    [
      ['gpt-5.6-sol', 'long', 'priority', 50_001],
      ['gpt-5.6-sol', 'short', 'standard', 50_000],
      ['openai/gpt-6-astra', 'long', 'standard', 72_001],
    ],
  );
});

test('GPT-6.2 context uses each request including cache hits, not the half-hour total', async () => {
  const home = useHome('gpt-62-context');
  const rows = ['gpt-6.2-astra', 'openai/gpt-6.2-sol'].flatMap((model) =>
    [272_000, 272_001].map((input, idx) => tokenEvent('2026-11-22T10:01:00Z', {
      model, service_tier: idx ? 'fast' : 'standard', last_token_usage: usage(input, 270_000, 10, 0),
    })));
  writeRollout(home, 'sessions', 'rollout.jsonl', [meta('fixture', '2026-11-22T10:00:00Z'), ...rows]);
  const { buckets } = await parse({ sessionSalt: SALT });
  assert.equal(buckets.length, 4);
  for (const b of buckets) {
    assert.equal(b.contextTier, b.inputTokens === 2000 ? 'short' : 'long');
    assert.equal(b.processingTier, b.contextTier === 'short' ? 'standard' : 'priority');
  }
});

test('two genuine sub-agent tasks starting three seconds apart both count', async () => {
  const home = useHome('rapid-subagent');
  const at = s => new Date(Date.UTC(2026, 10, 22, 12, 0, s)).toISOString();
  const start = s => ({ type: 'event_msg', timestamp: at(s), payload: { type: 'task_started', started_at: Date.parse(at(s)) / 1000 } });
  const call = (s, n) => tokenEvent(at(s), { last_token_usage: usage(n, 0, 0, 0) });
  writeRollout(home, 'sessions', 'child.jsonl', [meta('child', at(0), { parent_thread_id: 'parent' }),
    start(-3), call(-2, 99), start(0), call(1, 11), start(3), call(4, 22)]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(sumTokens(result).input, 33);
  assert.equal(sumTokens(result).requests, 2);
});

test('resumed requests retain their own project, provider and version; a mixed session stays one session', async () => {
  const home = useHome('resumed-attributes');
  for (const [i, project, provider, n] of [[1, 'red', 'direct', 10], [2, 'blue', 'relay', 20]]) {
    const at = s => new Date(Date.UTC(2026, 10, 22, 12, i, s)).toISOString();
    writeRollout(home, 'sessions', i + '.jsonl', [meta('thread', at(0), { cwd: '/example/' + project, model_provider: provider, cli_version: i + '.0' }),
      tokenEvent(at(1), { last_token_usage: usage(n, 0, 0, 0) })]);
  }
  const { buckets, sessions } = await parse({ sessionSalt: SALT });
  assert.deepEqual(buckets.map(b => [b.project, b.modelProvider, b.agentVersion, b.inputTokens]),
    [['red', 'direct', '1.0', 10], ['blue', 'relay', '2.0', 20]]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].project, 'unknown');
  assert.equal(sessions[0].agentVersion, '2.0'); // session summaries report the latest observed version
});

test('Ultrafast stays distinct from Standard locally and cannot enter a v2 upload under a false tier', async () => {
  const home = useHome('ultrafast');
  writeRollout(home, 'sessions', 'usage.jsonl', [meta('thread', '2026-11-22T10:00:00Z'),
    ...['standard', 'ultrafast'].map(service_tier => tokenEvent('2026-11-22T10:01:00Z',
      { model: 'gpt-6.2-sol', service_tier, last_token_usage: usage(10000, 0, 0, 0) }))]);
  const { buckets } = await parse({ sessionSalt: SALT });
  assert.deepEqual(buckets.map(b => b.processingTier), ['standard', 'ultrafast']);
  const { validateLocalBucket, validateUploadBucket } = await import('../src/protocol.js');
  assert.equal(validateLocalBucket(buckets[1]), null);
  assert.match(validateUploadBucket(buckets[1]), /ultrafast/i);
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

test('resumed segments retain both unique calls and repeated real calls, overlapping accounting rows count once', async () => {
  const home = useHome('resumed');
  const at = (n) => new Date(Date.UTC(2026, 10, 22, 12, n)).toISOString();
  const call = (n, i) => tokenEvent(at(n), { model: 'gpt-6.2-sol', last_token_usage: usage(i, 1, 2, 0) });
  const shared = call(2, 20);
  const first = [meta('one-thread', at(0)), call(1, 10), shared, shared];
  writeRollout(home, 'sessions', 'part-1.jsonl', first);
  writeRollout(home, 'archived_sessions', 'part-1-copy.jsonl', first);
  writeRollout(home, 'sessions', 'part-2.jsonl', [meta('one-thread', at(3)), shared, shared, call(4, 30)]);
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.skipped, undefined);
  assert.equal(result.sessions.length, 1);
  assert.deepEqual(sumTokens(result), { input: 76, cacheWrite: 0, cacheRead: 4, output: 8, reasoning: 0, requests: 4 });
});

test('contradictory order between continuation segments keeps a partial scan', async () => {
  const home = useHome('resumed-conflict');
  const a = tokenEvent('2026-11-22T10:01:00Z', { last_token_usage: usage(10, 0, 2, 0) });
  const b = tokenEvent('2026-11-22T10:02:00Z', { last_token_usage: usage(20, 0, 2, 0) });
  writeRollout(home, 'sessions', 'part-1.jsonl', [meta('one', '2026-11-22T10:00:00Z'), a, b]);
  writeRollout(home, 'sessions', 'part-2.jsonl', [meta('one', '2026-11-22T10:03:00Z'), b, a]);
  const result = await parse({ sessionSalt: SALT });
  assert.ok(result.skipped);
  assert.equal(sumTokens(result).requests, 2);
});

test('configured Codex homes are additive and deduplicate copied sessions globally', async () => {
  const primary = useHome('multi-primary');
  const extra = join(root, 'multi-extra');
  mkdirSync(join(extra, 'sessions'), { recursive: true });
  writeRollout(primary, 'sessions', 'rollout-shared.jsonl', [
    meta('shared-multi', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(1, 0, 1, 0) }),
  ]);
  writeRollout(extra, 'sessions', 'rollout-shared-copy.jsonl', [
    meta('shared-multi', '2026-08-01T10:01:00.000Z'),
    tokenEvent('2026-08-01T10:02:00.000Z', { last_token_usage: usage(10, 0, 2, 0) }),
    tokenEvent('2026-08-01T10:03:00.000Z', { last_token_usage: usage(20, 0, 3, 0) }),
  ]);
  writeRollout(extra, 'sessions', 'rollout-extra.jsonl', [
    meta('extra-only', '2026-08-01T10:04:00.000Z'),
    tokenEvent('2026-08-01T10:05:00.000Z', { last_token_usage: usage(5, 0, 1, 0) }),
  ]);
  const result = await parse({
    sessionSalt: SALT,
    sourceOptions: { codex: { extraRoots: [extra] } },
  });
  assert.deepEqual(sumTokens(result), {
    input: 35, cacheWrite: 0, cacheRead: 0, output: 6, reasoning: 0, requests: 3,
  });
  assert.equal(result.sessions.length, 2);
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
