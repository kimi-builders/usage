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

test('Grok CLI reads the usage.json ledger when updates carry no usage', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kbu-grok-ledger-'));
  const path = join(home, 'sessions', encodeURIComponent('/work/grok-demo'), 'session-ledger');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'summary.json'), JSON.stringify({
    info: { cwd: '/work/grok-demo' },
    created_at: '2026-09-20T02:16:15.000Z',
    updated_at: '2026-09-20T02:20:00.000Z',
    current_model_id: 'grok-4.6',
  }));
  // 1.x builds keep token accounting out of the ACP stream: turn_completed
  // carries no usage, the totals live in usage.json (what `grok usage` reads).
  writeFileSync(join(path, 'updates.jsonl'), [
    { timestamp: 1790000000, params: { update: { sessionUpdate: 'user_message_chunk' } } },
    { timestamp: 1790000010, params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' } } },
    { timestamp: 1790001900, params: { update: { sessionUpdate: 'user_message_chunk' } } },
    { timestamp: 1790002000, params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' } } },
  ].map(JSON.stringify).join('\n'));
  writeFileSync(join(path, 'usage.json'), JSON.stringify({
    session: { inputTokens: 1100, outputTokens: 250, cachedReadTokens: 720, cacheCreationTokens: 50, reasoningTokens: 43, totalTokens: 1350, modelCalls: 4 },
    turns: [
      { turnNumber: 1, inputTokens: 1000, outputTokens: 200, cachedReadTokens: 700, cacheCreationTokens: 50, reasoningTokens: 33, totalTokens: 1200, modelCalls: 2,
        modelUsage: { 'grok-4.6-build': { inputTokens: 1000, outputTokens: 200, cachedReadTokens: 700, cacheCreationTokens: 50, reasoningTokens: 33, modelCalls: 2 } } },
      { turnNumber: 2, inputTokens: 100, outputTokens: 50, cachedReadTokens: 20, cacheCreationTokens: 0, reasoningTokens: 10, totalTokens: 150, modelCalls: 2 },
    ],
  }));
  const previous = process.env.GROK_HOME;
  const previousSessions = process.env.KBU_USAGE_GROK_SESSIONS;
  process.env.GROK_HOME = home;
  delete process.env.KBU_USAGE_GROK_SESSIONS;
  try {
    const result = await parse({ sessionSalt: SALT });
    const buckets = result.buckets.filter((bucket) => bucket.source === 'grok');
    assert.ok(buckets.length >= 1);
    const sum = (key) => buckets.reduce((total, bucket) => total + (bucket[key] || 0), 0);
    // input = (1000 + 50 cache write) - 700 cache read + 100 - 20
    assert.equal(sum('inputTokens'), 350 + 80);
    assert.equal(sum('outputTokens'), 167 + 40);
    assert.equal(sum('cacheReadInputTokens'), 700 + 20);
    assert.equal(sum('reasoningOutputTokens'), 33 + 10);
    // Grok publishes no separate cache-write rate: the ledger's
    // cacheCreationTokens fold into input and the cache-write bucket stays 0.
    assert.equal(sum('cacheWriteInputTokens'), 0);
    // A turn that carries modelUsage is attributed to the model it names; a
    // turn without one falls back to the summary's current_model_id.
    const models = new Set(buckets.map((bucket) => bucket.model));
    assert.ok(models.has('grok-4.6-build'));
    assert.ok(models.has('grok-4.6'));
    // both turns are attributed to their own turn_completed timestamps
    assert.equal(new Set(buckets.map((bucket) => bucket.bucketStart)).size, 2);
    assert.equal(result.warnings, undefined);
  } finally {
    if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous;
    if (previousSessions === undefined) delete process.env.KBU_USAGE_GROK_SESSIONS; else process.env.KBU_USAGE_GROK_SESSIONS = previousSessions;
    rmSync(home, { recursive: true, force: true });
  }
});

test('usage.json is ignored when updates.jsonl already carries turn usage', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kbu-grok-ledger-both-'));
  const path = join(home, 'sessions', encodeURIComponent('/work/grok-demo'), 'session-both');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'summary.json'), JSON.stringify({ info: { cwd: '/work/grok-demo' }, current_model_id: 'grok-4.6' }));
  writeFileSync(join(path, 'updates.jsonl'), [
    { timestamp: 1790000010, params: { update: { sessionUpdate: 'turn_completed', usage: {
      inputTokens: 100, outputTokens: 50, cachedReadTokens: 20, reasoningTokens: 10,
    } } } },
  ].map(JSON.stringify).join('\n'));
  // Same turn present in both places: the ACP copy is authoritative (it has
  // the timestamp and model), so the ledger must not add a second entry.
  writeFileSync(join(path, 'usage.json'), JSON.stringify({
    turns: [{ turnNumber: 1, inputTokens: 100, outputTokens: 50, cachedReadTokens: 20, cacheCreationTokens: 0, reasoningTokens: 10, modelCalls: 1 }],
  }));
  const previous = process.env.GROK_HOME;
  const previousSessions = process.env.KBU_USAGE_GROK_SESSIONS;
  process.env.GROK_HOME = home;
  delete process.env.KBU_USAGE_GROK_SESSIONS;
  try {
    const result = await parse({ sessionSalt: SALT });
    const buckets = result.buckets.filter((bucket) => bucket.source === 'grok');
    const sum = (key) => buckets.reduce((total, bucket) => total + (bucket[key] || 0), 0);
    assert.equal(sum('inputTokens'), 80);
    assert.equal(sum('outputTokens'), 40);
    assert.equal(sum('cacheReadInputTokens'), 20);
    assert.equal(sum('reasoningOutputTokens'), 10);
  } finally {
    if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous;
    if (previousSessions === undefined) delete process.env.KBU_USAGE_GROK_SESSIONS; else process.env.KBU_USAGE_GROK_SESSIONS = previousSessions;
    rmSync(home, { recursive: true, force: true });
  }
});

test('Grok CLI warns when a session reports turns but no usage can be read', async () => {
  const home = mkdtempSync(join(tmpdir(), 'kbu-grok-canary-'));
  const path = join(home, 'sessions', encodeURIComponent('/work/grok-demo'), 'session-canary');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'summary.json'), JSON.stringify({ info: { cwd: '/work/grok-demo' }, current_model_id: 'grok-4.6' }));
  // Turn finished, but neither the ACP stream nor a usage.json ledger carries
  // the numbers — the shape of the next format move.
  writeFileSync(join(path, 'updates.jsonl'), [
    { timestamp: 1790000010, params: { update: { sessionUpdate: 'turn_completed', stop_reason: 'end_turn' } } },
  ].map(JSON.stringify).join('\n'));
  writeFileSync(join(path, 'signals.json'), JSON.stringify({
    turnCount: 2,
    modelsUsed: ['grok-4.6'],
    primaryModelId: 'grok-4.6',
  }));
  const previous = process.env.GROK_HOME;
  const previousSessions = process.env.KBU_USAGE_GROK_SESSIONS;
  process.env.GROK_HOME = home;
  delete process.env.KBU_USAGE_GROK_SESSIONS;
  try {
    const result = await parse({ sessionSalt: SALT });
    assert.deepEqual(result.buckets, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /no readable usage/);
    assert.match(result.warnings[0], /session-canary/);
    assert.equal(result.skipped, true);
  } finally {
    if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous;
    if (previousSessions === undefined) delete process.env.KBU_USAGE_GROK_SESSIONS; else process.env.KBU_USAGE_GROK_SESSIONS = previousSessions;
    rmSync(home, { recursive: true, force: true });
  }
});

const oldTurnUsage = { inputTokens: 100, outputTokens: 10, modelCalls: 1 };
const newTurnUsage = { inputTokens: 200, outputTokens: 20, modelCalls: 1 };
const completed = (timestamp, usage) => ({ timestamp, params: { update: {
  sessionUpdate: 'turn_completed', ...(usage ? { usage } : {}),
} } });

async function parseMixedFixture(updates, ledger, summary = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-grok-mixed-'));
  const previous = process.env.KBU_USAGE_GROK_SESSIONS;
  process.env.KBU_USAGE_GROK_SESSIONS = directory;
  try {
    const session = join(directory, 'demo', 'mixed-session');
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, 'summary.json'), JSON.stringify({
      current_model_id: 'grok-4.5', updated_at: '2026-10-08T12:00:00Z', ...summary,
    }));
    writeFileSync(join(session, 'updates.jsonl'), updates.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n');
    writeFileSync(join(session, 'signals.json'), JSON.stringify({ turnCount: updates.length, modelsUsed: ['grok-4.5'] }));
    if (ledger) writeFileSync(join(session, 'usage.json'), JSON.stringify(ledger));
    return await parse({ sessionSalt: SALT });
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_GROK_SESSIONS; else process.env.KBU_USAGE_GROK_SESSIONS = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test('resumed sessions reconcile ACP and ledger turns once, including sparse/out-of-order ledgers', async () => {
  for (const turns of [
    [{ turnNumber: 1, ...oldTurnUsage }, { turnNumber: 2, ...newTurnUsage }],
    [{ turnNumber: 2, ...newTurnUsage }],
    [{ turnNumber: 2, ...newTurnUsage }, { turnNumber: 1, ...oldTurnUsage }],
    [oldTurnUsage, newTurnUsage],
  ]) {
    const result = await parseMixedFixture([
      completed('2026-10-07T10:00:00Z', oldTurnUsage), completed('2026-10-08T10:00:00Z'),
    ], { turns });
    assert.equal(result.skipped, undefined);
    assert.equal(result.warnings, undefined);
    assert.deepEqual(result.buckets.map((row) => [row.bucketStart, row.inputTokens, row.outputTokens, row.requestCount]), [
      ['2026-10-07T10:00:00.000Z', 100, 10, 1], ['2026-10-08T10:00:00.000Z', 200, 20, 1],
    ]);
  }
});

test('ambiguous or missing ledger turns retain known ACP usage but mark the scan partial', async () => {
  for (const ledger of [
    null,
    { session: { inputTokens: 300, outputTokens: 30 } },
    { turns: [newTurnUsage] }, // Numberless partial ledger cannot establish turn identity.
    { turns: [{ turnNumber: 2, ...newTurnUsage }, { turnNumber: 2, ...newTurnUsage }] },
    { turns: [{ turnNumber: 3, ...newTurnUsage }] },
  ]) {
    const result = await parseMixedFixture([
      completed('2026-10-07T10:00:00Z', oldTurnUsage), completed('2026-10-08T10:00:00Z'),
    ], ledger);
    assert.equal(result.skipped, true);
    assert.match(result.warnings[0], /could not be matched/);
    assert.equal(result.buckets.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0), 110);
  }
});

test('invalid ACP timestamps keep their slot instead of shifting subsequent ledger dates', async () => {
  const result = await parseMixedFixture([
    completed('invalid'), completed('2026-10-08T10:00:00Z'),
  ], { turns: [{ turnNumber: 1, ...oldTurnUsage }, { turnNumber: 2, ...newTurnUsage }] });
  assert.equal(result.skipped, true);
  assert.deepEqual(result.buckets.map((row) => [row.bucketStart, row.inputTokens]), [['2026-10-08T10:00:00.000Z', 200]]);
});

test('a malformed or truncated ACP stream cannot safely align numbered ledger usage', async () => {
  for (const updates of [
    [completed('2026-10-07T10:00:00Z', oldTurnUsage), '{broken', completed('2026-10-08T10:00:00Z')],
    [completed('2026-10-08T10:00:00Z')],
  ]) {
    const result = await parseMixedFixture(updates, { turns: [{ turnNumber: 1, ...oldTurnUsage }, { turnNumber: 2, ...newTurnUsage }] });
    assert.equal(result.skipped, true);
    assert.equal(result.buckets.reduce((sum, row) => sum + row.inputTokens, 0), updates.length > 1 ? 100 : 0);
  }
});

test('explicit zero-usage turns are complete evidence, not unreadable sessions', async () => {
  for (const fromLedger of [false, true]) {
    const zero = { inputTokens: 0, outputTokens: 0 };
    const result = await parseMixedFixture([completed('2026-10-08T10:00:00Z', fromLedger ? null : zero)],
      fromLedger ? { turns: [{ turnNumber: 1, ...zero }] } : null);
    assert.equal(result.skipped, undefined);
    assert.equal(result.warnings, undefined);
    assert.deepEqual(result.buckets, []);
  }
});

test('numeric-string ACP counters are not re-added from the ledger', async () => {
  const result = await parseMixedFixture([
    completed('2026-10-07T10:00:00Z', { inputTokens: '100', outputTokens: '10' }),
    completed('2026-10-08T10:00:00Z'),
  ], { turns: [{ turnNumber: 1, ...oldTurnUsage }, { turnNumber: 2, ...newTurnUsage }] });
  assert.equal(result.skipped, undefined);
  assert.equal(result.buckets.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0), 330);
});

test('cumulative or untimed ledger usage never moves with session metadata timestamps', async () => {
  for (const ledger of [
    { session: { inputTokens: 300, outputTokens: 30 } },
    { turns: [{ turnNumber: 1, ...oldTurnUsage }, { turnNumber: 2, ...newTurnUsage }] },
  ]) {
    for (const updates of [[], [completed(null), completed('invalid')]]) {
      for (const updated_at of ['2026-10-08T12:00:00Z', '2026-10-09T12:00:00Z']) {
        const result = await parseMixedFixture(updates, ledger, { created_at: '2026-10-07T23:00:00Z', updated_at });
        assert.deepEqual(result.buckets, [], 'summary metadata cannot establish Token occurrence times');
        assert.equal(result.skipped, true);
        assert.match(result.warnings.join(' '), /partial/);
        assert.ok(result.sessions.length > 0, 'session metadata remains available independently');
      }
    }
  }
});

test('even timestamped completion events cannot distribute session totals across turns or days', async () => {
  const result = await parseMixedFixture([
    completed('2026-10-07T23:59:00Z'), completed('2026-10-08T00:01:00Z'),
  ], { session: { inputTokens: 300, outputTokens: 30 } });
  assert.deepEqual(result.buckets, []);
  assert.equal(result.skipped, true);
});
