import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadStepPlanCredentials, fetchStepFunLimits } from '../src/limits/providers/stepfun.js';

const login = (access, expires = Date.now() + 60_000) => ({
  step: { type: 'oauth', profile: 'step_plan', access, expires },
});
const emptyQuota = () => Response.json({ schema_version: 1, scope: 'personal_account',
  plan: { family: 'none' }, quota: { state: 'known', windows: [], credit_buckets: [] } });

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'kbu-step-login-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = join(home, '.stepcode');
  const agent = join(config, 'agent');
  mkdirSync(agent, { recursive: true });
  return { home, config, agent, current: join(config, 'auth.json'), legacy: join(agent, 'auth.json') };
}

const write = (path, value) => writeFileSync(path, JSON.stringify(value));

test('authoritative StepCode auth never revives a legacy account after logout or invalid current login', async t => {
  const f = fixture(t);
  const environment = { STEP_CODING_AGENT_DIR: f.agent };
  write(f.legacy, login('previous-account'));
  for (const value of [{}, { step: null }, { step: { type: 'api_key', key: 'gateway-key' } },
    { step: { ...login('current').step, profile: 'platform_cn' } }]) {
    write(f.current, value);
    assert.deepEqual(loadStepPlanCredentials(environment, { home: f.home }), { found: false });
    let calls = 0;
    await assert.rejects(fetchStepFunLimits({ environment, home: f.home,
      fetcher: () => { calls++; return emptyQuota(); } }), { code: 'not_configured' });
    assert.equal(calls, 0);
  }
  writeFileSync(f.current, '{broken');
  assert.deepEqual(loadStepPlanCredentials(environment, { home: f.home }), { found: false });
});

test('StepCode rereads the selected current login and never falls back on expiry', async t => {
  const f = fixture(t);
  write(f.legacy, login('previous-account'));
  for (const access of ['account-a', 'account-b']) {
    write(f.current, login(access));
    const calls = [];
    await fetchStepFunLimits({ environment: {}, home: f.home, fetcher: (url, options) => {
      calls.push(options.headers.Authorization);
      return emptyQuota();
    } });
    assert.deepEqual(calls, [`Bearer ${access}`]);
  }
  for (const expires of [Date.now() - 1, String(Date.now() + 60_000), 'invalid']) {
    write(f.current, login('expired-current', expires));
    assert.equal(loadStepPlanCredentials({}, { home: f.home }).fresh, false);
    await assert.rejects(fetchStepFunLimits({ environment: {}, home: f.home,
      fetcher: () => { throw new Error('must not request'); } }), { code: 'unauthorized' });
  }
});

test('StepCode legacy discovery is allowed only when the authoritative file is absent', t => {
  const f = fixture(t);
  write(f.legacy, login('legacy-login'));
  assert.equal(loadStepPlanCredentials({}, { home: f.home }).access, 'legacy-login');
  // An existing but unreadable current store is also an account boundary.
  mkdirSync(f.current);
  assert.deepEqual(loadStepPlanCredentials({}, { home: f.home }), { found: false });
});

test('StepCode auth overrides are exclusive and custom agent directories use their parent config root', t => {
  const f = fixture(t);
  write(f.current, login('current-login'));
  write(f.legacy, login('legacy-login'));
  const custom = join(f.home, 'selected-auth.json');
  write(custom, login('explicit-login'));
  assert.equal(loadStepPlanCredentials({ STEPCODE_AUTH_PATH: custom }, { home: f.home }).access, 'explicit-login');
  assert.deepEqual(loadStepPlanCredentials({ STEPCODE_AUTH_PATH: join(f.home, 'missing.json') }, { home: f.home }), { found: false });
  assert.equal(loadStepPlanCredentials({ STEP_CODING_AGENT_DIR: relative(process.cwd(), f.agent) }, { home: f.home }).access, 'current-login');
  assert.equal(loadStepPlanCredentials({ STEP_CODING_AGENT_DIR: f.agent }, { home: f.home }).access, 'current-login');
  const customConfig = join(f.home, '.custom-step');
  mkdirSync(customConfig);
  write(join(customConfig, 'auth.json'), login('custom-config-login'));
  assert.equal(loadStepPlanCredentials({ STEPCODE_CONFIG_DIR: '.custom-step' }, { home: f.home }).access, 'custom-config-login');
});
