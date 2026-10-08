import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexTurnPerformance, compactCodexCompletion } from '../src/parsers/codex-performance.js';
import { parse } from '../src/parsers/codex.js';
import { collectAll, collectLocalSnapshot } from '../src/local/snapshot.js';
import { createDashboardData } from '../src/local/dashboard-data.js';

const epoch = Date.parse('2026-10-08T10:00:00Z');
const stamp = second => new Date(epoch + second * 1_000).toISOString();
const usage = (output = 100) => ({ input_tokens: 200, cached_input_tokens: 20, output_tokens: output, reasoning_output_tokens: 10, total_tokens: 200 + output });
const context = { type: 'turn_context', timestamp: stamp(0), payload: { turn_id: 'turn', model: 'gpt-5.6-sol', effort: 'high' } };
const ledger = extra => ({ type: 'token_usage_record', timestamp: stamp(1), payload: { thread_id: 'thread', session_id: 'thread', response_id: 'response', turn_id: 'turn', usage: usage(), thread_token_usage: usage(), turn_token_usage: usage(), ...extra } });
const done = extra => ({ type: 'event_msg', timestamp: stamp(10), payload: { type: 'task_complete', turn_id: 'turn', duration_ms: 10_000, started_at: epoch / 1_000, time_to_first_token_ms: 500, ...extra } });
const run = rows => codexTurnPerformance(rows, 'thread', 'thread', { project: 'fixture-project', agentVersion: '1.0' });

test('Codex timings join verified durable usage, count reasoning in output and retain only local metadata', () => {
  const rows = run([context, ledger(), ledger(), done()]);
  assert.equal(rows.length, 1); assert.equal(rows[0].outputTokens, 100);
  assert.equal(rows[0].durationMs, 10_000); assert.equal(rows[0].firstTokenMs, 500);
  assert.equal(rows[0].reasoningEffort, 'high'); assert.equal(rows[0].project, 'fixture-project');
  assert.doesNotMatch(JSON.stringify(rows), /turn_id|response_id|thread_id|session_id/);
  assert.deepEqual(compactCodexCompletion({ ...done().payload, error: 'secret-error', content: 'private-prompt' }).error, true);
  assert.doesNotMatch(JSON.stringify(compactCodexCompletion({ ...done().payload, error: 'secret-error', content: 'private-prompt' })), /secret-error|private-prompt/);
});

test('Codex missing, failed, conflicting, aborted and incomplete turns never become performance samples', () => {
  for (const rows of [
    [ledger()], [done()], [ledger(), done({ error: 'failed' })],
    [ledger(), done(), done({ error: true })], [ledger(), done({ duration_ms: 0 })],
    [ledger(), done(), done({ duration_ms: 9_000 })],
    [ledger(), done(), done({ type: 'turn_aborted' })],
    [ledger(), done(), { ...done(), timestamp: 'invalid' }],
    [context, ledger(), ledger({ turn_id: null }), done()],
    [ledger({ turn_token_usage: null }), done()],
    [ledger({ turn_token_usage: usage(101) }), done()],
    [ledger({ usage: usage(-1) }), done()],
    [ledger({ response_id: null }), done()],
    [ledger({ thread_id: 'parent' }), done()],
    [ledger({ session_id: 'foreign-execution' }), done()],
    [ledger(), ledger({ usage: usage(102) }), done()],
    [ledger(), { ...done(), timestamp: stamp(-1) }],
    [ledger(), done({ started_at: (epoch + 2_000) / 1_000 })],
    [ledger(), done({ started_at: 'invalid' })],
  ]) assert.equal(run(rows).length, 0, JSON.stringify(rows));
});

test('Codex invalid TTFT remains unknown without discarding otherwise complete timing', () => {
  for (const ttft of [-1, 10_001, 1.2, '500', undefined]) assert.equal(run([ledger(), done({ time_to_first_token_ms: ttft })])[0].firstTokenMs, null);
  assert.equal(run([ledger(), done({ time_to_first_token_ms: 0 })])[0].firstTokenMs, 0);
});

test('Codex multi-request turn sums complete totals and rejects reused response ownership', () => {
  const twice = Object.fromEntries(Object.entries(usage()).map(([key, value]) => [key, value * 2]));
  const rows = run([context, ledger(), ledger({ response_id: 'second', turn_token_usage: twice, thread_token_usage: twice }), done()]);
  assert.equal(rows.length, 1); assert.equal(rows[0].outputTokens, 200);
  assert.equal(run([ledger(), done(), ledger({ turn_id: 'other' }), done({ turn_id: 'other' })]).length, 0);
});

test('real Codex parser deduplicates physical copies; snapshot timings never enter collector sync results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-performance-'));
  const old = process.env.KBU_USAGE_CODEX_HOME;
  process.env.KBU_USAGE_CODEX_HOME = root;
  try {
    const rows = [{ type: 'session_meta', timestamp: stamp(0), payload: { id: 'thread', cwd: '/fixture/project', cli_version: '1.0' } }, context, ledger(), done()];
    for (const directory of ['sessions', 'archived_sessions']) {
      mkdirSync(join(root, directory)); writeFileSync(join(root, directory, 'copy.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
    }
    const sourceEntries = [{ id: 'codex', tier: 'core', roots: async () => [root], parse }];
    const input = { sessionSalt: 'performance-fixture-salt'.padEnd(32, 'x'), sourceEntries };
    const synced = await collectAll(input);
    assert.doesNotMatch(JSON.stringify(synced), /turnPerformance|durationMs|firstTokenMs|outputTokensPerSecond/);
    const snapshot = await collectLocalSnapshot({ ...input, config: {}, generatedAt: new Date(stamp(20)) });
    assert.equal(snapshot.data.turnPerformance.length, 1);
    assert.equal(snapshot.data.buckets[0].requestCount, 1);
    const data = createDashboardData(snapshot, { config: {}, device: {}, agentVersions: {} });
    assert.equal(data.turnPerformance.length, 1);
    assert.equal(data.turnPerformance[0].durationMs, 10_000);
    assert.doesNotMatch(JSON.stringify(data.turnPerformance), /turn_id|response_id|thread_id|\/fixture/);
    writeFileSync(join(root, 'sessions', 'copy.jsonl'), [...rows, { ...done(), timestamp: 'invalid' }].map(JSON.stringify).join('\n') + '\n');
    const invalidated = await parse({ sessionSalt: input.sessionSalt, includePerformance: true });
    assert.equal(invalidated.turnPerformance.length, 0);
  } finally {
    if (old == null) delete process.env.KBU_USAGE_CODEX_HOME; else process.env.KBU_USAGE_CODEX_HOME = old;
    rmSync(root, { recursive: true, force: true });
  }
});
