import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parse, roots } from '../src/parsers/stepcode.js';
import { runtimeEnvironment, renderDaemonFiles } from '../src/daemon.js';
import { parseStepPlanQuota, fetchStepFunLimits } from '../src/limits/providers/stepfun.js';
import { normalizeLimitHistory } from '../src/limits/history.js';

test('StepCode honors its official session directory without falling back to default data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-step-directory-'));
  const keys = ['KBU_USAGE_STEPCODE_SESSIONS', 'STEP_CODING_AGENT_SESSION_DIR', 'STEP_CODING_AGENT_DIR'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const sessionDir = join(root, 'custom sessions');
    mkdirSync(sessionDir);
    writeFileSync(join(sessionDir, 'session.jsonl'), `${[
      { type: 'session', id: 'custom', cwd: '/synthetic/custom' },
      { type: 'message', id: 'm1', timestamp: '2026-10-28T00:00:00Z',
        message: { role: 'assistant', model: 'step-5-preview', usage: { input: 10, output: 1 } } },
    ].map(JSON.stringify).join('\n')}\n`);
    delete process.env.KBU_USAGE_STEPCODE_SESSIONS;
    process.env.STEP_CODING_AGENT_DIR = join(root, 'absent-agent');
    process.env.STEP_CODING_AGENT_SESSION_DIR = sessionDir;
    assert.deepEqual(roots(), [sessionDir]);
    assert.equal((await parse({ sessionSalt: 'synthetic-salt-long-enough-for-tests' })).buckets[0].inputTokens, 10);
    process.env.STEP_CODING_AGENT_SESSION_DIR = join(root, 'absent-session');
    assert.deepEqual(roots(), []);
    assert.equal(await parse({ sessionSalt: 'synthetic-salt-long-enough-for-tests' }), null);
    process.env.STEP_CODING_AGENT_SESSION_DIR = sessionDir;
    process.env.KBU_USAGE_STEPCODE_SESSIONS = '';
    assert.deepEqual(roots(), []);
    process.env.KBU_USAGE_STEPCODE_SESSIONS = [sessionDir, sessionDir].join(delimiter);
    assert.deepEqual(roots(), [sessionDir]);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('StepCode source paths survive all daemon descriptors, including official session overrides', t => {
  const home = mkdtempSync(join(tmpdir(), 'kbu-step-daemon-paths-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sessionDir = join(home, 'sessions');
  mkdirSync(sessionDir);
  const environment = { STEP_CODING_AGENT_SESSION_DIR: sessionDir, STEPCODE_CONFIG_DIR: '.custom-step' };
  assert.deepEqual(runtimeEnvironment(environment), environment);
  assert.deepEqual(roots({ environment: runtimeEnvironment(environment), home }), [sessionDir]);
  for (const platform of ['darwin', 'linux', 'win32']) {
    const descriptor = renderDaemonFiles({ platform, home, configDir: join(home, 'config'), environment })
      .files.map(file => file.content).join('\n');
    assert.ok(descriptor.includes('STEP_CODING_AGENT_SESSION_DIR'), platform);
    assert.ok(descriptor.includes('STEPCODE_CONFIG_DIR'), platform);
  }
});

test('StepCode roots respect config namespaces, home expansion and exclusive override priority', t => {
  const home = mkdtempSync(join(tmpdir(), 'kbu-step-root-rules-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const sessions = join(home, '.custom-step', 'agent', 'sessions');
  mkdirSync(sessions, { recursive: true });
  const environment = { STEPCODE_CONFIG_DIR: '.custom-step' };
  assert.deepEqual(roots({ environment, home }), [sessions]);
  assert.deepEqual(roots({ environment: { ...environment, STEP_CODING_AGENT_SESSION_DIR: '~/.custom-step/agent/sessions' }, home }), [sessions]);
  assert.deepEqual(roots({ environment: { ...environment, STEP_CODING_AGENT_SESSION_DIR: join(home, 'missing') }, home }), []);
  assert.deepEqual(roots({ environment: { ...environment, KBU_USAGE_STEPCODE_SESSIONS: '' }, home }), []);
  assert.deepEqual(roots({ environment: { ...environment, STEP_CODING_AGENT_SESSION_DIR: sessions,
    KBU_USAGE_STEPCODE_SESSIONS: join(home, 'missing') }, home }), []);
});

test('StepCode counts exclusive tokens and compaction once across session copies', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-stepcode-'));
  const previous = process.env.KBU_USAGE_STEPCODE_SESSIONS;
  process.env.KBU_USAGE_STEPCODE_SESSIONS = root;
  try {
    mkdirSync(join(root, 'project'));
    const header = { type: 'session', id: 'one', cwd: '/synthetic/project' };
    const message = { type: 'message', id: 'm1', timestamp: '2026-10-28T00:00:00Z',
      message: { role: 'assistant', model: 'step-5-preview', usage: { input: 10, output: 7, reasoning: 2, cacheRead: 3, cacheWrite: 4 } } };
    const compaction = { type: 'compaction', id: 'c1', timestamp: '2026-10-28T00:01:00Z', usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 } };
    const contents = [header, message, compaction].map(JSON.stringify).join('\n');
    writeFileSync(join(root, 'project', 'a.jsonl'), `${contents}\n`);
    writeFileSync(join(root, 'project', 'b.jsonl'), `${contents}\n`);
    const result = await parse({ sessionSalt: 'synthetic-salt-long-enough-for-tests' });
    assert.equal(result.skipped, undefined);
    const totals = result.buckets.reduce((a, b) => ({ input: a.input + b.inputTokens, output: a.output + b.outputTokens,
      reasoning: a.reasoning + b.reasoningOutputTokens, read: a.read + b.cacheReadInputTokens, write: a.write + b.cacheWriteInputTokens }),
    { input: 0, output: 0, reasoning: 0, read: 0, write: 0 });
    assert.deepEqual(totals, { input: 12, output: 6, reasoning: 2, read: 3, write: 4 });
    writeFileSync(join(root, 'project', 'corrupt.jsonl'), `${contents}\n{broken\n`);
    assert.equal((await parse({ sessionSalt: 'synthetic-salt-long-enough-for-tests' })).skipped, true);
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_STEPCODE_SESSIONS;
    else process.env.KBU_USAGE_STEPCODE_SESSIONS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('forks without usage provenance stay partial and cannot invent duplicate usage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-step-fork-'));
  const previous = process.env.KBU_USAGE_STEPCODE_SESSIONS;
  process.env.KBU_USAGE_STEPCODE_SESSIONS = root;
  try {
    const usage = { type: 'message', id: 'm1', timestamp: '2026-10-28T00:00:00Z',
      message: { role: 'assistant', model: 'step-5-preview', usage: { input: 10, output: 1 } } };
    writeFileSync(join(root, 'one.jsonl'), `${[ { type: 'session', id: 'one', cwd: '/synthetic/project' }, usage ].map(JSON.stringify).join('\n')}\n`);
    writeFileSync(join(root, 'two.jsonl'), `${[ { type: 'session', id: 'two', parentSessionId: 'one', cwd: '/synthetic/project' }, usage ].map(JSON.stringify).join('\n')}\n`);
    const result = await parse({ sessionSalt: 'synthetic-salt-long-enough-for-tests' });
    assert.equal(result.skipped, true);
    assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.inputTokens, 0), 10);
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_STEPCODE_SESSIONS;
    else process.env.KBU_USAGE_STEPCODE_SESSIONS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('Step Plan quota distinguishes percentages, unlimited and token-plan Credits', () => {
  const base = { schema_version: 1, scope: 'personal_account', plan: { family: 'coding', name: 'Pro' },
    quota: { state: 'known', windows: [
      { id: 'five_hour', limited: true, used_percent: 35, resets_at_ms: null },
      { id: 'weekly', limited: false, used_percent: null, resets_at_ms: null },
    ], credit_buckets: [] } };
  const now = new Date('2026-10-29T00:00:00Z');
  const coding = parseStepPlanQuota(base, { now });
  assert.equal(coding.windows.length, 1);
  assert.equal(coding.windows[0].remainingPercent, 65);
  assert.equal(coding.windows[0].limit, null);
  const token = parseStepPlanQuota({ ...base, plan: { family: 'token' }, quota: { state: 'known', windows: [], credit_buckets: [
    { type: 'subscription', used_percent: 25, resets_at_ms: null },
    { type: 'topup', used_percent: null }, { type: 'future', used_percent: 50 },
  ] } }, { now });
  assert.equal(token.windows.length, 1);
  assert.equal(token.windows[0].remainingPercent, 75);
  assert.equal(token.windows[0].windowSeconds, null);
  assert.throws(() => parseStepPlanQuota({ ...base, quota: { ...base.quota, windows: [{ id: 'five_hour', limited: true, used_percent: 130 }] } }));
});

test('Step Plan uses only its saved Plan OAuth and fixed regional endpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-step-auth-'));
  try {
    writeFileSync(join(root, 'auth.json'), JSON.stringify({ step: { type: 'oauth', profile: 'step_plan_oversea', access: 'synthetic-access' } }));
    const payload = { schema_version: 1, scope: 'personal_account', plan: { family: 'none' }, quota: { state: 'known', windows: [], credit_buckets: [] } };
    const result = await fetchStepFunLimits({ environment: { STEP_CODING_AGENT_DIR: join(root, 'agent') }, fetcher: async (url, options) => {
      assert.equal(String(url), 'https://api.stepfun.ai/step_plan/v1/usage');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify(payload), { status: 200 });
    } });
    assert.equal(result.status, 'empty');
    writeFileSync(join(root, 'auth.json'), JSON.stringify({ step: { type: 'api_key', profile: 'platform_cn', key: 'synthetic-key' } }));
    await assert.rejects(fetchStepFunLimits({ environment: { STEP_CODING_AGENT_DIR: join(root, 'agent') }, fetcher: () => { throw new Error('must not request'); } }), { code: 'not_configured' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('multiple same-kind Credit buckets are displayed but never mixed in history', () => {
  const now = new Date('2026-10-29T00:00:00Z');
  const result = parseStepPlanQuota({ schema_version: 1, scope: 'personal_account', plan: { family: 'token' },
    quota: { state: 'known', windows: [], credit_buckets: [
      { type: 'subscription', used_percent: 10 }, { type: 'topup', used_percent: 30 },
      { type: 'topup', used_percent: 50 },
    ] } }, { now });
  assert.deepEqual(result.windows.map(w => w.id), ['credit-subscription', 'credit-topup-1', 'credit-topup-2']);
  const history = normalizeLimitHistory({ observations: [{ observedAt: now.toISOString(), providers: [result] }] }, { now: now.getTime() });
  assert.deepEqual(history.observations[0].providers[0].windows.map(w => w.id), ['credit-subscription']);
});
