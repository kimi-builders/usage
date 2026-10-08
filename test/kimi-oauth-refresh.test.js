import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLimitSettings } from '../src/limits/catalog.js';
import { ensureFreshKimiCredentials } from '../src/limits/providers/kimi-oauth.js';
import { fetchKimiLimits } from '../src/limits/providers/kimi.js';
import { getPublicLimitSettings } from '../src/limits/service.js';

function fixture(t, { fresh = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'usage-kimi-oauth-'));
  const credentialsDirectory = join(root, 'credentials');
  const path = join(credentialsDirectory, 'kimi-code.json');
  mkdirSync(credentialsDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'device_id'), 'device-fixture', { mode: 0o600 });
  const payload = {
    access_token: fresh ? 'fresh-access' : 'expired-access',
    refresh_token: 'refresh-old',
    expires_at: Math.floor(Date.now() / 1_000) + (fresh ? 3_600 : -60),
    expires_in: 900,
    scope: 'openid',
    token_type: 'Bearer',
    preserved_field: 'keep-me',
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, path, environment: { ...process.env, KIMI_CODE_HOME: root, KIMI_SHARE_DIR: '' } };
}

function tokenResponse(overrides = {}) {
  return new Response(JSON.stringify({
    access_token: 'refreshed-access',
    refresh_token: 'refresh-new',
    expires_in: 900,
    scope: 'openid',
    token_type: 'Bearer',
    ...overrides,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function usageResponse() {
  return new Response(JSON.stringify({
    limits: [{
      detail: { limit: 100, used: 25, resetTime: '2026-08-20T00:00:00Z' },
      window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
    }],
    usage: { limit: 100, used: 40, resetTime: '2026-08-24T00:00:00Z' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// os.homedir() reads $HOME / $USERPROFILE live, so pointing both at the fixture
// keeps the "no login anywhere" cases hermetic even on machines with a real login.
function isolateHomeDirectory(root) {
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test('renews an expired Kimi Code login before reading usage without requiring /status', async (t) => {
  const local = fixture(t);
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (url.hostname === 'auth.kimi.com') return tokenResponse();
    assert.equal(options.headers.Authorization, 'Bearer refreshed-access');
    return usageResponse();
  };

  const result = await fetchKimiLimits({
    settings: { authMode: 'local' }, environment: local.environment, fetcher,
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.map((call) => new URL(call.url).hostname), ['auth.kimi.com', 'api.kimi.com']);
  const refreshRequest = calls[0];
  const form = new URLSearchParams(refreshRequest.options.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'refresh-old');
  assert.equal(refreshRequest.options.headers['X-Msh-Device-Id'], 'device-fixture');
  assert.match(refreshRequest.options.headers['User-Agent'], /^kbu-usage\//);
  const saved = JSON.parse(readFileSync(local.path, 'utf8'));
  assert.equal(saved.access_token, 'refreshed-access');
  assert.equal(saved.refresh_token, 'refresh-new');
  assert.equal(saved.preserved_field, 'keep-me');
  if (process.platform !== 'win32') {
    assert.equal(statSync(local.path).mode & 0o777, 0o600);
  }
  assert.equal(JSON.stringify(result).includes('refreshed-access'), false);
  assert.equal(JSON.stringify(result).includes('refresh-new'), false);
  assert.throws(() => statSync(join(local.root, 'oauth', 'kimi-code.lock')), { code: 'ENOENT' });
});

test('renews a legacy 1.x login in place when the 2.x home holds no login', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'usage-kimi-legacy-oauth-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const legacyPath = join(root, '.kimi', 'credentials', 'kimi-code.json');
  mkdirSync(join(root, '.kimi', 'credentials'), { recursive: true, mode: 0o700 });
  writeFileSync(legacyPath, `${JSON.stringify({
    access_token: 'legacy-access',
    refresh_token: 'refresh-old',
    expires_at: Math.floor(Date.now() / 1_000) - 60,
  }, null, 2)}\n`, { mode: 0o600 });
  const environment = {
    ...process.env,
    KIMI_CODE_HOME: join(root, '.kimi-code'),
    KIMI_SHARE_DIR: join(root, '.kimi'),
  };
  const result = await fetchKimiLimits({
    settings: { authMode: 'local' },
    environment,
    fetcher: async (url, options) => {
      if (url.hostname === 'auth.kimi.com') return tokenResponse();
      assert.equal(options.headers.Authorization, 'Bearer refreshed-access');
      return usageResponse();
    },
  });
  assert.equal(result.status, 'ok');
  const saved = JSON.parse(readFileSync(legacyPath, 'utf8'));
  assert.equal(saved.access_token, 'refreshed-access');
  assert.equal(saved.refresh_token, 'refresh-new');
  // The refresh lock follows the detected login, not the 2.x home.
  assert.throws(() => statSync(join(root, '.kimi', 'oauth', 'kimi-code.lock')), { code: 'ENOENT' });
  assert.throws(() => statSync(join(root, '.kimi-code', 'oauth')), { code: 'ENOENT' });
});

test('uses a fresh Kimi Code access token without contacting the OAuth host', async (t) => {
  const local = fixture(t, { fresh: true });
  const hosts = [];
  const result = await fetchKimiLimits({
    settings: { authMode: 'local' },
    environment: local.environment,
    fetcher: async (url, options) => {
      hosts.push(url.hostname);
      assert.equal(options.headers.Authorization, 'Bearer fresh-access');
      return usageResponse();
    },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(hosts, ['api.kimi.com']);
});

test('reports an expired but refreshable Kimi Code login as detected', (t) => {
  const local = fixture(t);
  const isolatedEnvironment = {
    ...local.environment,
    PATH: '',
    CODEX_HOME: local.root,
    CLAUDE_CONFIG_DIR: local.root,
    CURSOR_STATE_DB: join(local.root, 'missing-cursor.db'),
    CODEXBAR_HOME: local.root,
  };
  const settings = getPublicLimitSettings({
    subscriptionLimits: normalizeLimitSettings({ providers: {
      'kimi-code': { enabled: true, authMode: 'local' },
    } }),
  }, {
    detectCredentials: true, environment: isolatedEnvironment,
    keychainAvailable: false,
    hasSecret: () => false,
    run: () => ({ status: 1, stdout: '' }),
    platform: 'linux',
  });
  assert.equal(
    settings.catalog.find((provider) => provider.id === 'kimi-code').detection.state,
    'detected',
  );
});

test('Kimi stale-login detection carries the recovery command like sibling providers', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'usage-kimi-detect-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const restoreHome = isolateHomeDirectory(home);
  const settings = () => getPublicLimitSettings({
    subscriptionLimits: normalizeLimitSettings({ providers: {
      'kimi-code': { enabled: true, authMode: 'local' },
    } }),
  }, {
    detectCredentials: true,
    environment: {
      KIMI_CODE_HOME: join(home, 'absent-home'), KIMI_SHARE_DIR: '',
      PATH: '', CODEX_HOME: home, CLAUDE_CONFIG_DIR: home,
      CURSOR_STATE_DB: join(home, 'missing-cursor.db'), CODEXBAR_HOME: home,
    },
    keychainAvailable: false, hasSecret: () => false,
    run: () => ({ status: 1, stdout: '' }), platform: 'linux',
  });
  try {
    // No login anywhere: name the command that creates one.
    const missing = settings().catalog.find((provider) => provider.id === 'kimi-code').detection;
    assert.equal(missing.state, 'needs_login');
    assert.match(missing.detail, /运行 kimi/);

    // An expired login without a refresh token cannot self-renew: point at the
    // CLI renewal and the automatic reread instead of a bare label. The file
    // sits on the default 2.x path under the isolated home, behind the absent
    // KIMI_CODE_HOME in the probe order.
    mkdirSync(join(home, '.kimi-code', 'credentials'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.kimi-code', 'credentials', 'kimi-code.json'), `${JSON.stringify({
      access_token: 'expired-access', expires_at: Math.floor(Date.now() / 1_000) - 60,
    }, null, 2)}\n`, { mode: 0o600 });
    const expired = settings().catalog.find((provider) => provider.id === 'kimi-code').detection;
    assert.equal(expired.state, 'expired');
    assert.match(expired.detail, /运行 kimi/);
    assert.match(expired.detail, /无需重启/);
  } finally {
    restoreHome();
  }
});

test('Kimi local fetch errors name the recovery path and the independent API-key account', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'usage-kimi-recovery-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const restoreHome = isolateHomeDirectory(home);
  try {
    // Missing login: name the recovery command and the independent key option.
    await assert.rejects(fetchKimiLimits({
      settings: { authMode: 'local' },
      environment: { KIMI_CODE_HOME: join(home, 'absent-home'), KIMI_SHARE_DIR: '' },
      fetcher: async () => { throw new Error('network must not be reached'); },
    }), (error) => error.code === 'not_configured'
      && /运行 kimi/.test(error.message) && /Kimi for Coding API Key/.test(error.message));

    // Expired without a refresh token: recovery is running kimi, not a restart.
    mkdirSync(join(home, 'credentials'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, 'credentials', 'kimi-code.json'), `${JSON.stringify({
      access_token: 'expired-access', expires_at: Math.floor(Date.now() / 1_000) - 60,
    }, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(fetchKimiLimits({
      settings: { authMode: 'local' },
      environment: { KIMI_CODE_HOME: home, KIMI_SHARE_DIR: '' },
      fetcher: async () => { throw new Error('network must not be reached'); },
    }), (error) => error.code === 'unauthorized'
      && /运行 kimi/.test(error.message) && /Kimi for Coding API Key/.test(error.message));
  } finally {
    restoreHome();
  }
});

test('rotates the login once and retries usage once after a 401', async (t) => {
  const local = fixture(t, { fresh: true });
  const calls = [];
  const result = await fetchKimiLimits({
    settings: { authMode: 'local' },
    environment: local.environment,
    fetcher: async (url, options) => {
      calls.push({ host: url.hostname, authorization: options.headers.Authorization || null });
      if (url.hostname === 'auth.kimi.com') return tokenResponse();
      if (calls.filter((call) => call.host === 'api.kimi.com').length === 1) {
        return new Response('{"error":"expired"}', { status: 401 });
      }
      assert.equal(options.headers.Authorization, 'Bearer refreshed-access');
      return usageResponse();
    },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.map((call) => call.host), ['api.kimi.com', 'auth.kimi.com', 'api.kimi.com']);
});

test('coalesces concurrent refreshes for the same Kimi credential file', async (t) => {
  const local = fixture(t);
  let refreshes = 0;
  const fetcher = async () => {
    refreshes += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return tokenResponse();
  };
  const [first, second] = await Promise.all([
    ensureFreshKimiCredentials({ environment: local.environment, fetcher }),
    ensureFreshKimiCredentials({ environment: local.environment, fetcher }),
  ]);
  assert.equal(refreshes, 1);
  assert.equal(first.accessToken, 'refreshed-access');
  assert.equal(second.accessToken, 'refreshed-access');
});

test('retries a transient OAuth failure and preserves the CLI credential on success', async (t) => {
  const local = fixture(t);
  let attempts = 0;
  const waits = [];
  const credential = await ensureFreshKimiCredentials({
    environment: local.environment,
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    fetcher: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response('{"error":"busy"}', { status: 503 })
        : tokenResponse();
    },
  });
  assert.equal(credential.accessToken, 'refreshed-access');
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1_000]);
});

test('does not overwrite the Kimi Code credential when refresh is rejected', async (t) => {
  const local = fixture(t);
  const before = readFileSync(local.path, 'utf8');
  await assert.rejects(
    ensureFreshKimiCredentials({
      environment: local.environment,
      fetcher: async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    }),
    (error) => error.code === 'unauthorized' && /运行 kimi/.test(error.message),
  );
  assert.equal(readFileSync(local.path, 'utf8'), before);
  assert.throws(() => statSync(join(local.root, 'oauth', 'kimi-code.lock')), { code: 'ENOENT' });
});
