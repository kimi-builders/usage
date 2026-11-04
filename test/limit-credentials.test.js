import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { loadCodexCredentials, loadCodexCredentialsRereading, loadCursorCredentials, kimiCredentialPaths, loadKimiCredentials } from '../src/limits/credentials.js';
import { fetchCodexLimits } from '../src/limits/providers/codex.js';
import { fetchOpenCodeGoLimits, openCodeDataRoots, readLocalGoKey } from '../src/limits/providers/opencode.js';
import { clearLimitCache, loadSubscriptionLimits } from '../src/limits/service.js';
import { recordLimitSnapshot } from '../src/limits/history.js';
import { buildSubscriptionInsights } from '../dashboard/src/subscription-insights.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // node:sqlite unavailable (Node < 22.5) — DB-backed tests skip, auth.json tests run.
}

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function tempDirectory(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Cursor local auth decodes ASCII JWTs stored as UTF-16LE SQLite BLOBs', (t) => {
  const root = tempDirectory(t, 'usage-cursor-auth-');
  const path = join(root, 'state.vscdb');
  writeFileSync(path, 'fixture');
  const accessToken = jwt({ sub: 'auth0|cursor-user', exp: Math.floor(Date.now() / 1_000) + 3_600 });
  const result = loadCursorCredentials({ CURSOR_STATE_DB: path }, {
    query: () => [{ value: Buffer.from(accessToken, 'utf16le') }],
  });
  assert.equal(result.found, true);
  assert.equal(result.fresh, true);
  assert.equal(result.accessToken, accessToken);
  assert.equal(result.cookie, `WorkosCursorSessionToken=cursor-user%3A%3A${accessToken}`);
});

test('Codex local auth honors access-token JWT expiry and preserves opaque tokens', (t) => {
  const root = tempDirectory(t, 'usage-codex-auth-');
  const idToken = jwt({ email: 'builder@example.com', chatgpt_plan_type: 'pro' });
  const writeAuth = (accessToken) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
      access_token: accessToken, id_token: idToken, account_id: 'account-1',
    } }));
  };

  writeAuth(jwt({ exp: Math.floor(Date.now() / 1_000) - 60 }));
  const expired = loadCodexCredentials({ CODEX_HOME: root });
  assert.equal(expired.found, true);
  assert.equal(expired.fresh, false);
  assert.equal(expired.email, 'builder@example.com');

  writeAuth('opaque-access-token');
  const opaque = loadCodexCredentials({ CODEX_HOME: root });
  assert.equal(opaque.found, true);
  assert.equal(opaque.fresh, true);
  assert.equal(opaque.expiresAt, null);
});

test('Codex quota fetch rejects an expired local token before network access', async (t) => {
  const root = tempDirectory(t, 'usage-codex-expired-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
    access_token: jwt({ exp: Math.floor(Date.now() / 1_000) - 1 }),
  } }));
  let networkCalls = 0;
  await assert.rejects(fetchCodexLimits({
    environment: { CODEX_HOME: root },
    fetcher: async () => {
      networkCalls += 1;
      throw new Error('network must not be reached');
    },
  }), (error) => error?.code === 'unauthorized' && /重新登录/.test(error.message));
  assert.equal(networkCalls, 0);
});

// --- Bounded auth.json reread: the CLI may publish credentials mid-fetch ---

test('Codex credentials reread auth.json when the file appears during the wait', async (t) => {
  const root = tempDirectory(t, 'usage-codex-reread-missing-');
  mkdirSync(root, { recursive: true });
  const sleeps = [];
  const freshToken = jwt({ exp: Math.floor(Date.now() / 1_000) + 3_600 });
  const appeared = await loadCodexCredentialsRereading({ CODEX_HOME: root }, {
    sleep: async (ms) => {
      sleeps.push(ms);
      writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: { access_token: freshToken } }));
    },
  });
  assert.equal(appeared.found, true);
  assert.equal(appeared.fresh, true);
  assert.deepEqual(sleeps, [50]);
});

test('Codex credentials reread auth.json when a partial publish lacks the access token', async (t) => {
  const root = tempDirectory(t, 'usage-codex-reread-partial-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: { id_token: 'half-published' } }));
  const sleeps = [];
  const freshToken = jwt({ exp: Math.floor(Date.now() / 1_000) + 3_600 });
  const completed = await loadCodexCredentialsRereading({ CODEX_HOME: root }, {
    sleep: async (ms) => {
      sleeps.push(ms);
      writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: { access_token: freshToken } }));
    },
  });
  assert.equal(completed.found, true);
  assert.equal(completed.fresh, true);
  assert.deepEqual(sleeps, [50]);
});

test('Codex credentials reread auth.json when the token is at or past expiry', async (t) => {
  const root = tempDirectory(t, 'usage-codex-reread-stale-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
    access_token: jwt({ exp: Math.floor(Date.now() / 1_000) - 30 }),
  } }));
  const sleeps = [];
  const refreshed = await loadCodexCredentialsRereading({ CODEX_HOME: root }, {
    sleep: async (ms) => {
      sleeps.push(ms);
      writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
        access_token: jwt({ exp: Math.floor(Date.now() / 1_000) + 3_600 }),
      } }));
    },
  });
  assert.equal(refreshed.found, true);
  assert.equal(refreshed.fresh, true);
  assert.deepEqual(sleeps, [50]);
});

test('Codex credentials stop after two bounded rereads and keep the real login state', async (t) => {
  const root = tempDirectory(t, 'usage-codex-reread-bound-');
  mkdirSync(root, { recursive: true });
  const sleeps = [];
  const stillMissing = await loadCodexCredentialsRereading({ CODEX_HOME: root }, {
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(stillMissing.found, false);
  assert.deepEqual(sleeps, [50, 50]);

  // The attempt count stays injectable and zero attempts never wait.
  sleeps.length = 0;
  const staleRoot = tempDirectory(t, 'usage-codex-reread-noattempts-');
  mkdirSync(staleRoot, { recursive: true });
  writeFileSync(join(staleRoot, 'auth.json'), JSON.stringify({ tokens: {
    access_token: jwt({ exp: Math.floor(Date.now() / 1_000) - 30 }),
  } }));
  const stillStale = await loadCodexCredentialsRereading({ CODEX_HOME: staleRoot }, {
    attempts: 0,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(stillStale.found, true);
  assert.equal(stillStale.fresh, false);
  assert.deepEqual(sleeps, []);
});

test('Codex credentials skip the reread when the login is already fresh', async (t) => {
  const root = tempDirectory(t, 'usage-codex-reread-fresh-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
    access_token: 'opaque-access-token',
  } }));
  const sleeps = [];
  const fresh = await loadCodexCredentialsRereading({ CODEX_HOME: root }, {
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(fresh.found, true);
  assert.equal(fresh.fresh, true);
  assert.deepEqual(sleeps, []);
});

test('Codex quota fetch recovers when the CLI publishes fresh credentials mid-fetch', async (t) => {
  const root = tempDirectory(t, 'usage-codex-midfetch-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
    access_token: jwt({ exp: Math.floor(Date.now() / 1_000) - 30 }),
  } }));
  const requests = [];
  const result = await fetchCodexLimits({
    environment: { CODEX_HOME: root },
    sleep: async () => {
      writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
        access_token: jwt({ exp: Math.floor(Date.now() / 1_000) + 3_600 }),
      } }));
    },
    fetcher: async (url) => {
      requests.push(String(url));
      return jsonResponse({ plan_type: 'pro', rate_limit: {
        primary_window: { used_percent: 25, reset_at: '2026-08-12T15:00:00.000Z', limit_window_seconds: 18_000 },
      } });
    },
  });
  // Usage plus reset-credit probe; the reread happened before any network call.
  assert.equal(requests.length, 2);
  assert.equal(result.status, 'ok');
  assert.equal(result.plan, 'pro');
});

test('Codex quota fetch keeps the not-configured error after the bounded rereads', async (t) => {
  const root = tempDirectory(t, 'usage-codex-reread-none-');
  mkdirSync(root, { recursive: true });
  let sleeps = 0;
  let networkCalls = 0;
  await assert.rejects(fetchCodexLimits({
    environment: { CODEX_HOME: root },
    sleep: async () => { sleeps += 1; },
    fetcher: async () => { networkCalls += 1; return jsonResponse({}); },
  }), (error) => error?.code === 'not_configured' && /请先运行 codex/.test(error.message));
  assert.equal(sleeps, 2);
  assert.equal(networkCalls, 0);
});

// --- OpenCode Go read-only local login fallback (no manual credential) ---

const USAGE_PAYLOAD = {
  usage: {
    rolling: { percent: 18, resetsAt: '2026-08-12T02:00:00.000Z' },
    weekly: { percent: 33, resetsAt: '2026-08-18T00:00:00.000Z' },
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Writes an OpenCode-shaped credential table at `<root>/opencode.db`. */
function credentialFixture(root, rows) {
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(join(root, 'opencode.db'));
  try {
    db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, value TEXT, active INTEGER, time_updated INTEGER)');
    const insert = db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?)');
    rows.forEach((row, index) => insert.run(
      `cred-${index}`, row.integrationId, JSON.stringify(row.value), row.active ?? 1, index,
    ));
  } finally {
    db.close();
  }
}

const localLoginSettings = { authMode: 'local' };

test('Kimi credential discovery probes both CLI generations and the first existing login wins', (t) => {
  const root = tempDirectory(t, 'usage-kimi-auth-');
  const currentPath = join(root, '.kimi-code', 'credentials', 'kimi-code.json');
  const legacyPath = join(root, '.kimi', 'credentials', 'kimi-code.json');
  const absentCodeHome = join(root, 'absent-home');
  const login = (accessToken) => JSON.stringify({
    access_token: accessToken, refresh_token: `${accessToken}-refresh`,
    expires_at: Math.floor(Date.now() / 1_000) + 3_600,
  });

  // With no login anywhere the current CLI's 2.x path is named, not the legacy one.
  assert.deepEqual(kimiCredentialPaths({ KIMI_CODE_HOME: absentCodeHome, KIMI_SHARE_DIR: '' }, root), [
    join(absentCodeHome, 'credentials', 'kimi-code.json'),
    currentPath,
    legacyPath,
  ]);
  assert.equal(loadKimiCredentials({ KIMI_CODE_HOME: absentCodeHome, KIMI_SHARE_DIR: '' }, { home: root }).path,
    join(absentCodeHome, 'credentials', 'kimi-code.json'));

  mkdirSync(join(root, '.kimi-code', 'credentials'), { recursive: true });
  mkdirSync(join(root, '.kimi', 'credentials'), { recursive: true });
  writeFileSync(legacyPath, login('legacy-token'));
  writeFileSync(join(root, '.kimi', 'device_id'), 'legacy-device');

  // A configured-but-absent home cannot shadow an existing legacy 1.x login.
  const legacy = loadKimiCredentials({ KIMI_CODE_HOME: absentCodeHome, KIMI_SHARE_DIR: '' }, { home: root });
  assert.equal(legacy.found, true);
  assert.equal(legacy.path, legacyPath);
  assert.equal(legacy.root, join(root, '.kimi'));
  assert.equal(legacy.deviceId, 'legacy-device');
  assert.equal(legacy.fresh, true);
  assert.equal(loadKimiCredentials({
    KIMI_CODE_HOME: absentCodeHome, KIMI_SHARE_DIR: join(root, '.kimi'),
  }, { home: root }).path, legacyPath);

  // The current 2.x login outranks the legacy one in the default order.
  writeFileSync(currentPath, login('current-token'));
  const current = loadKimiCredentials({ KIMI_CODE_HOME: join(root, '.kimi-code'), KIMI_SHARE_DIR: '' }, { home: root });
  assert.equal(current.found, true);
  assert.equal(current.path, currentPath);
  assert.equal(current.accessToken, 'current-token');
  assert.equal(current.deviceId, null);
});

test('OpenCode data roots follow node:path join and platform delimiter rules', () => {
  // Build every expectation with the platform's own rules: the provider joins
  // with node:path and splits the override on the platform delimiter, so a
  // hardcoded POSIX literal (or a `:`-joined override) would fail on Windows.
  // The native Windows store supplements XDG, even when XDG is configured.
  const home = '/Users/example';
  const native = process.platform === 'win32'
    ? [join(home, 'AppData', 'Local', 'opencode')] : [];
  assert.deepEqual(openCodeDataRoots({}, home),
    [join(home, '.local', 'share', 'opencode'), ...native]);
  assert.deepEqual(openCodeDataRoots({ XDG_DATA_HOME: '/xdg-home' }, home),
    [join('/xdg-home', 'opencode'), ...native]);
  assert.deepEqual(openCodeDataRoots({ XDG_DATA_HOME: '/xdg-home', LOCALAPPDATA: '/local-app-data' }, home),
    [join('/xdg-home', 'opencode'), ...(process.platform === 'win32' ? [join('/local-app-data', 'opencode')] : [])]);
  assert.deepEqual(
    openCodeDataRoots(
      { KBU_USAGE_OPENCODE_DIR: ['/a/opencode', '/b/opencode'].join(delimiter) },
      '/Users/example',
    ),
    ['/a/opencode', '/b/opencode'],
  );
});

test('OpenCode Go reuses the local credential-table login read-only when no manual credential is configured', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-table-');
  credentialFixture(root, [{ integrationId: 'opencode-go', value: { type: 'key', key: 'sk-local-go-key' } }]);
  const requests = [];
  const result = await fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), authorization: init.headers.Authorization });
      return jsonResponse(USAGE_PAYLOAD);
    },
  });
  assert.equal(new URL(requests[0].url).pathname, '/zen/go/v1/usage');
  assert.equal(requests[0].authorization, 'Bearer sk-local-go-key');
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'OpenCode 本机登录');
  assert.deepEqual(result.windows.map((window) => window.remainingPercent), [82, 67]);
  assert.match(result.notice, /不回写/);
  // The key lives only in the request: it must not reach the serialized
  // result that the settings cache, history, or output persist.
  assert.equal(JSON.stringify(result).includes('sk-local-go-key'), false);
});

test('OpenCode Go prefers the Go-specific credential row over the 1.x auth.json login', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-priority-');
  credentialFixture(root, [{ integrationId: 'opencode-go', value: { type: 'key', key: 'sk-table-key' } }]);
  writeFileSync(join(root, 'auth.json'), JSON.stringify({
    opencode: { type: 'api', key: 'sk-auth-file-key' },
  }));
  let authorization;
  const result = await fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async (_url, init) => {
      authorization = init.headers.Authorization;
      return jsonResponse(USAGE_PAYLOAD);
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(authorization, 'Bearer sk-table-key');
});

test('OpenCode Go never revives legacy auth when a modern credential table has no active Go login', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-auth-');
  credentialFixture(root, [{ integrationId: 'anthropic', value: { type: 'oauth', access: 'must-not-be-read' } }]);
  writeFileSync(join(root, 'auth.json'), JSON.stringify({
    anthropic: { type: 'oauth', access: 'must-not-be-read' },
    opencode: { type: 'api', key: '  sk-auth-file-key  ' },
  }));
  let calls = 0;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async () => { calls++; return jsonResponse(USAGE_PAYLOAD); },
  }), { code: 'not_configured' });
  assert.equal(calls, 0);
});

test('OpenCode Go cannot borrow legacy auth when the credential store is unreadable', async (t) => {
  const root = tempDirectory(t, 'usage-opencode-corrupt-');
  writeFileSync(join(root, 'opencode.db'), 'not a sqlite database');
  writeFileSync(join(root, 'auth.json'), JSON.stringify({
    opencode: { type: 'api', key: 'sk-auth-file-key' },
  }));
  let calls = 0;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async () => { calls++; return jsonResponse(USAGE_PAYLOAD); },
  }), { code: 'provider_error' });
  assert.equal(calls, 0);
});

test('OpenCode active-account selection rejects ambiguity/expiry and accepts current OAuth without renewal', async t => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const now = Date.parse('2026-10-29T00:00:00Z');
  const active = { integrationId: 'opencode-go', value: { type: 'key', key: 'active-key' } };
  const oauth = { integrationId: 'opencode', value: { type: 'oauth', access: 'active-oauth', expires: now + 60000 } };
  for (const [rows, expected] of [
    [[active, { ...active, active: 0, value: { type: 'key', key: 'disabled-newer-key' } }], { status: 'ok', key: 'active-key' }],
    [[active, active], { status: 'error' }],
    [[{ ...active, active: 0 }], { status: 'missing' }],
    [[oauth], { status: 'ok', key: 'active-oauth' }],
    [[oauth, active], { status: 'ok', key: 'active-key' }],
    [[{ ...oauth, value: { ...oauth.value, expires: now } }], { status: 'error' }],
    [[{ ...oauth, value: { ...oauth.value, expires: String(now + 60000) } }], { status: 'error' }],
    [[{ ...active, value: { type: 'key', key: 'unsafe\nheader' } }], { status: 'error' }],
    [[{ ...active, integrationId: 'opencode' }], { status: 'missing' }],
  ]) {
    const root = tempDirectory(t, 'usage-opencode-active-');
    const other = tempDirectory(t, 'usage-opencode-old-root-');
    credentialFixture(root, rows);
    for (const dir of [root, other]) writeFileSync(join(dir, 'auth.json'), JSON.stringify({ opencode: { type: 'api', key: 'stale' } }));
    assert.deepEqual(readLocalGoKey({ KBU_USAGE_OPENCODE_DIR: [root, other].join(delimiter) }, root, process.platform, now), expected);
  }
});

test('OpenCode legacy Go key remains usable when no credential table exists', t => {
  const root = tempDirectory(t, 'usage-opencode-legacy-go-');
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: 'legacy-go-key' },
    opencode: { type: 'api', key: 'older-key' } }));
  assert.deepEqual(readLocalGoKey({ KBU_USAGE_OPENCODE_DIR: root }), { status: 'ok', key: 'legacy-go-key' });
  if (DatabaseSync) {
    const db = new DatabaseSync(join(root, 'opencode.db'));
    db.exec('CREATE TABLE session (id TEXT)'); db.close();
    assert.deepEqual(readLocalGoKey({ KBU_USAGE_OPENCODE_DIR: root }), { status: 'ok', key: 'legacy-go-key' });
  }
});

test('OpenCode never switches roots after a corrupt legacy login file', t => {
  const first = tempDirectory(t, 'usage-opencode-legacy-corrupt-');
  const second = tempDirectory(t, 'usage-opencode-legacy-second-');
  writeFileSync(join(first, 'auth.json'), '{broken');
  writeFileSync(join(second, 'auth.json'), JSON.stringify({ opencode: { type: 'api', key: 'other-account' } }));
  assert.deepEqual(readLocalGoKey({ KBU_USAGE_OPENCODE_DIR: [first, second].join(delimiter) }), { status: 'error' });
});

test('OpenCode Go reports a missing local login without reaching the network', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-missing-');
  credentialFixture(root, [{ integrationId: 'anthropic', value: { type: 'oauth', access: 'x' } }]);
  writeFileSync(join(root, 'auth.json'), JSON.stringify({
    opencode: { type: 'api', key: '   ' },
  }));
  let calls = 0;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async () => { calls += 1; return jsonResponse(USAGE_PAYLOAD); },
  }), (error) => error?.code === 'not_configured');
  assert.equal(calls, 0);
});

test('OpenCode Go reports an unreadable local store instead of pretending there is no login', async (t) => {
  const root = tempDirectory(t, 'usage-opencode-error-');
  writeFileSync(join(root, 'opencode.db'), 'not a sqlite database');
  let calls = 0;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async () => { calls += 1; return jsonResponse(USAGE_PAYLOAD); },
  }), (error) => error?.code === 'provider_error');
  assert.equal(calls, 0);
});

test('OpenCode Go keeps a manually configured Cookie + Workspace ahead of the local login', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-manual-');
  credentialFixture(root, [{ integrationId: 'opencode-go', value: { type: 'key', key: 'sk-local-go-key' } }]);
  const requests = [];
  const result = await fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_SESSION_COOKIE', workspaceId: 'wrk_personal' },
    environment: { OPENCODE_SESSION_COOKIE: 'auth=session', KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async (url, init) => {
      requests.push({
        url: String(url),
        authorization: init.headers.Authorization ?? null,
        cookie: init.headers.Cookie,
      });
      return new Response('<script>weeklyUsage:{usagePercent:30,resetInSec:600}</script>', { status: 200 });
    },
  });
  assert.equal(new URL(requests[0].url).pathname, '/workspace/wrk_personal/go');
  assert.equal(requests[0].cookie, 'auth=session');
  assert.equal(requests[0].authorization, null);
  assert.equal(result.windows[0].remainingPercent, 70);
  assert.equal(JSON.stringify(result).includes('sk-local-go-key'), false);
});

test('OpenCode Go API-key accounts keep their not_configured error instead of silently reading the local login', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-account-');
  credentialFixture(root, [{ integrationId: 'opencode-go', value: { type: 'key', key: 'sk-local-go-key' } }]);
  let calls = 0;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: { authMode: 'environment', environmentVariable: 'OPENCODE_API_KEY', connectionType: 'api-key' },
    environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async () => { calls += 1; return jsonResponse(USAGE_PAYLOAD); },
  }), (error) => error?.code === 'not_configured');
  assert.equal(calls, 0);
});

test('OpenCode Go manual Cookie accounts never borrow a different local login', async (t) => {
  const root = tempDirectory(t, 'usage-opencode-no-borrow-');
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ opencode: { type: 'api', key: 'local-other-account' } }));
  for (const cookie of [undefined, 'not-a-cookie']) {
    let calls = 0;
    await assert.rejects(fetchOpenCodeGoLimits({
      settings: { authMode: 'environment', environmentVariable: 'COOKIE', accountId: 'manual-account', workspaceId: 'wrk_manual' },
      environment: { KBU_USAGE_OPENCODE_DIR: root, ...(cookie ? { COOKIE: cookie } : {}) },
      fetcher: async () => { calls++; return jsonResponse(USAGE_PAYLOAD); },
    }), error => error.code === 'not_configured');
    assert.equal(calls, 0);
  }
});

test('OpenCode local login identity changes with credentials and survives refresh failures', async (t) => {
  const root = tempDirectory(t, 'usage-opencode-identity-');
  const options = { settings: localLoginSettings, environment: { KBU_USAGE_OPENCODE_DIR: root },
    fetcher: async () => jsonResponse(USAGE_PAYLOAD) };
  const login = key => writeFileSync(join(root, 'auth.json'), JSON.stringify({ opencode: { type: 'api', key } }));
  login('local-account-a');
  const first = await fetchOpenCodeGoLimits(options);
  assert.match(first.accountId, /^local_[a-f0-9]{32}$/);
  assert.equal((await fetchOpenCodeGoLimits(options)).accountId, first.accountId);
  login('local-account-b');
  const second = await fetchOpenCodeGoLimits(options);
  assert.notEqual(first.accountId, second.accountId);
  await assert.rejects(fetchOpenCodeGoLimits({ ...options, fetcher: async () => jsonResponse({}, 401) }),
    error => error.code === 'unauthorized' && error.accountId === second.accountId);
  assert.doesNotMatch(JSON.stringify([first, second]), /local-account-[ab]/);
});

test('OpenCode detection, quota service and history use the selected local login without leaking keys', async t => {
  const root = tempDirectory(t, 'usage-opencode-service-');
  const environment = { KBU_USAGE_OPENCODE_DIR: root };
  const config = { subscriptionLimits: { enabled: true, providers: { opencode: { enabled: true, authMode: 'local' } } } };
  // Detection considers the whole catalog. Run it under an isolated home and
  // empty executable path so sibling providers never inspect real logins or gh.
  const detect = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { getPublicLimitSettings } from './src/limits/service.js';
    const { config, environment } = JSON.parse(readFileSync(0, 'utf8'));
    console.log(JSON.stringify(getPublicLimitSettings(config, { detectCredentials: true, environment,
      hasSecret: () => false, run: () => ({ status: 1 }), platform: 'fixture' })));
  `], { cwd: new URL('..', import.meta.url), input: JSON.stringify({ config, environment }), encoding: 'utf8',
    env: { ...process.env, HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, PATH: '' } }));
  assert.equal(detect().catalog.find(p => p.id === 'opencode').detection.state, 'not_detected');
  const login = key => writeFileSync(join(root, 'auth.json'), JSON.stringify({ opencode: { type: 'api', key } }));
  login('service-account-a');
  const detected = detect();
  assert.equal(detected.catalog.find(p => p.id === 'opencode').detection.state, 'detected');
  assert.equal(detected.providers.opencode.accounts.length, 0);
  assert.doesNotMatch(JSON.stringify(detected), /service-account-a/);
  const path = join(root, 'history.json');
  const options = { force: true, config, environment, historyLoader: () => ({ observations: [] }),
    historyRecorder: snapshot => recordLimitSnapshot(snapshot, { path }),
    fetcher: async () => jsonResponse(USAGE_PAYLOAD) };
  clearLimitCache();
  t.after(clearLimitCache);
  const first = await loadSubscriptionLimits(options);
  login('service-account-b');
  const second = await loadSubscriptionLimits({ ...options, fetcher: async () => jsonResponse({ usage: {
    rolling: { percent: 60, resetsAt: USAGE_PAYLOAD.usage.rolling.resetsAt },
    weekly: { percent: 70, resetsAt: USAGE_PAYLOAD.usage.weekly.resetsAt },
  } }) });
  assert.notEqual(first.providers[0].accountId, second.providers[0].accountId);
  const failed = await loadSubscriptionLimits({ ...options, fetcher: async () => jsonResponse({}, 401) });
  assert.equal(failed.providers[0].accountId, second.providers[0].accountId);
  const history = recordLimitSnapshot(second, { path });
  const identities = new Set(history.observations.flatMap(o => o.providers.map(p => p.accountId)));
  assert.equal(identities.size, 2);
  assert.doesNotMatch(JSON.stringify(history), /service-account-[ab]/);
  const insight = buildSubscriptionInsights({ generatedAt: second.generatedAt, buckets: [] }, { ...second, history });
  const localPoints = insight.providers[0].observationLog;
  assert.ok(localPoints.length > 0);
  assert.deepEqual([...new Set(localPoints.map(p => p.usedPercent))].sort(), [60, 70]);
});

test('OpenCode Go does not switch accounts through a later root when the selected store is unreadable', async (t) => {
  const first = tempDirectory(t, 'usage-opencode-root-a-');
  const second = tempDirectory(t, 'usage-opencode-root-b-');
  writeFileSync(join(first, 'opencode.db'), 'not a sqlite database');
  writeFileSync(join(second, 'auth.json'), JSON.stringify({
    opencode: { type: 'api', key: 'sk-second-root-key' },
  }));
  let calls = 0;
  await assert.rejects(fetchOpenCodeGoLimits({
    settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: [first, second].join(delimiter) },
    fetcher: async () => { calls++; return jsonResponse(USAGE_PAYLOAD); },
  }), { code: 'provider_error' });
  assert.equal(calls, 0);
});

test('OpenCode current CLI OAuth queries Go with its access token and never exposes or renews it', async t => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const root = tempDirectory(t, 'usage-opencode-oauth-');
  credentialFixture(root, [{ integrationId: 'opencode', value: { type: 'oauth', access: 'test-oauth-access',
    refresh: 'test-refresh-never-used', expires: Date.now() + 60000 } }]);
  let calls = 0;
  const result = await fetchOpenCodeGoLimits({ settings: localLoginSettings,
    environment: { KBU_USAGE_OPENCODE_DIR: root }, fetcher: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://opencode.ai/zen/go/v1/usage');
      assert.equal(init.headers.Authorization, 'Bearer test-oauth-access');
      return jsonResponse(USAGE_PAYLOAD);
    } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
  assert.doesNotMatch(JSON.stringify(result), /test-oauth|test-refresh/);
});
