import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalDashboardServer } from '../src/local/dashboard-server.js';

function http(port, path, headers = {}, { method = 'GET', body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path, headers, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

test('local dashboard requires capability cookie and rejects hostile Host/Origin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-dashboard-server-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<main>local dashboard</main>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log("ok")');
  let loads = 0;
  const local = await startLocalDashboardServer({
    launchBrowser: false,
    buildRoot: root,
    dataLoader: async () => ({ loads: ++loads }),
  });
  try {
    assert.equal((await http(local.port, '/')).status, 401);
    assert.equal((await http(local.port, '/', { Host: 'attacker.invalid' })).status, 421);

    const tokenPath = new URL(local.url).pathname + new URL(local.url).search;
    const authorized = await http(local.port, tokenPath);
    assert.equal(authorized.status, 303);
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];

    const hostile = await http(local.port, '/api/snapshot', {
      Cookie: cookie,
      Origin: 'https://attacker.invalid',
    });
    assert.equal(hostile.status, 403);

    const data = await http(local.port, '/api/snapshot', { Cookie: cookie });
    assert.equal(data.status, 200);
    assert.deepEqual(JSON.parse(data.body), { loads: 1 });
    assert.equal(data.headers['cache-control'], 'no-store');
    assert.match(data.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.match(data.headers['content-security-policy'], /font-src 'self'(?:;|$)/);

    const refreshed = await http(local.port, '/api/snapshot?refresh=1', { Cookie: cookie });
    assert.deepEqual(JSON.parse(refreshed.body), { loads: 2 });
  } finally {
    await local.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('quota settings API keeps capability and origin protections for writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-dashboard-limits-'));
  writeFileSync(join(root, 'index.html'), '<main>local dashboard</main>');
  let settings = { enabled: false, catalog: [] };
  let saved = null;
  const local = await startLocalDashboardServer({
    launchBrowser: false,
    buildRoot: root,
    dataLoader: async () => ({}),
    limitsLoader: async ({ force }) => ({ enabled: true, force, providers: [] }),
    limitSettingsLoader: () => settings,
    limitSettingsSaver: (payload) => { saved = payload; settings = { ...settings, enabled: payload.settings.enabled }; },
  });
  try {
    const tokenPath = new URL(local.url).pathname + new URL(local.url).search;
    const authorized = await http(local.port, tokenPath);
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];
    const limits = await http(local.port, '/api/limits?refresh=1', { Cookie: cookie });
    assert.equal(JSON.parse(limits.body).force, true);

    const hostile = await http(local.port, '/api/limits/settings', {
      Cookie: cookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json',
    }, { method: 'POST', body: JSON.stringify({ settings: { enabled: true } }) });
    assert.equal(hostile.status, 403);

    const invalidType = await http(local.port, '/api/limits/settings', { Cookie: cookie }, {
      method: 'POST', body: '{}',
    });
    assert.equal(invalidType.status, 415);

    const updated = await http(local.port, '/api/limits/settings', {
      Cookie: cookie, Origin: local.origin, 'Content-Type': 'application/json',
    }, { method: 'POST', body: JSON.stringify({ settings: { enabled: true }, secrets: { warp: 'not-echoed' } }) });
    assert.equal(updated.status, 200);
    assert.equal(JSON.parse(updated.body).enabled, true);
    assert.equal(saved.secrets.warp, 'not-echoed');
    assert.equal(updated.body.includes('not-echoed'), false);
  } finally {
    await local.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('sync API distinguishes status reads from explicit local actions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-dashboard-sync-'));
  writeFileSync(join(root, 'index.html'), '<main>local dashboard</main>');
  const actions = [];
  const local = await startLocalDashboardServer({
    launchBrowser: false,
    buildRoot: root,
    dataLoader: async () => ({}),
    syncStatusLoader: () => ({ connected: true, apiUrl: 'https://kimi.builders', daemon: { installed: false } }),
    syncAction: async (payload) => { actions.push(payload); return { connected: true, action: payload.action }; },
  });
  try {
    const tokenPath = new URL(local.url).pathname + new URL(local.url).search;
    const authorized = await http(local.port, tokenPath);
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];
    const status = await http(local.port, '/api/sync', { Cookie: cookie });
    assert.equal(JSON.parse(status.body).connected, true);

    const hostile = await http(local.port, '/api/sync', {
      Cookie: cookie, Origin: 'https://attacker.invalid', 'Content-Type': 'application/json',
    }, { method: 'POST', body: JSON.stringify({ action: 'sync' }) });
    assert.equal(hostile.status, 403);

    const result = await http(local.port, '/api/sync', {
      Cookie: cookie, Origin: local.origin, 'Content-Type': 'application/json',
    }, { method: 'POST', body: JSON.stringify({ action: 'install', intervalMinutes: 15 }) });
    assert.equal(JSON.parse(result.body).action, 'install');
    assert.deepEqual(actions, [{ action: 'install', intervalMinutes: 15 }]);
  } finally {
    await local.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('browser APIs return a stable error contract without raw filesystem details', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-dashboard-safe-error-'));
  const sentinel = '/Users/sentinel/private/quota-response.json';
  writeFileSync(join(root, 'index.html'), '<main>local dashboard</main>');
  const local = await startLocalDashboardServer({
    launchBrowser: false,
    buildRoot: root,
    dataLoader: async () => ({}),
    limitsLoader: async () => { throw new Error(`unable to read ${sentinel}`); },
  });
  try {
    const tokenPath = new URL(local.url).pathname + new URL(local.url).search;
    const authorized = await http(local.port, tokenPath);
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];
    const response = await http(local.port, '/api/limits', { Cookie: cookie });
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), {
      error: {
        code: 'internal_error',
        message: 'The local dashboard could not complete this request.',
      },
    });
    assert.equal(response.body.includes(sentinel), false);
  } finally {
    await local.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('development API can authorize then redirect to a loopback Vite server without a build', async () => {
  let browserOrigin = 'http://127.0.0.1:5173';
  const local = await startLocalDashboardServer({
    launchBrowser: false,
    serveStatic: false,
    authRedirectOrigin: () => browserOrigin,
    dataLoader: async () => ({ mode: 'development' }),
  });
  try {
    const tokenPath = new URL(local.url).pathname + new URL(local.url).search;
    const authorized = await http(local.port, tokenPath);
    assert.equal(authorized.status, 303);
    assert.equal(authorized.headers.location, `${browserOrigin}/`);
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];

    const snapshot = await http(local.port, '/api/snapshot', { Cookie: cookie });
    assert.deepEqual(JSON.parse(snapshot.body), { mode: 'development' });
    assert.equal((await http(local.port, '/not-an-api', { Cookie: cookie })).status, 404);

    browserOrigin = 'https://attacker.invalid';
    const rejected = await http(local.port, tokenPath);
    assert.equal(rejected.status, 500);
    assert.deepEqual(JSON.parse(rejected.body), {
      error: {
        code: 'internal_error',
        message: 'The local dashboard could not complete this request.',
      },
    });
  } finally {
    await local.close();
  }
});
