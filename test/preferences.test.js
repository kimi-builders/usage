import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreferencesStore } from '../src/local/preferences.js';
import { startLocalDashboardServer } from '../src/local/dashboard-server.js';

test('preferences survive new server ports, remain local, reject arbitrary keys, and preserve deletions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-preferences-'));
  const store = createPreferencesStore(directory);
  let local;
  try {
    assert.deepEqual(store.load(), {});
    store.save({ 'kbu.theme': 'dark', 'kbu.budget.v1': '{"metric":"tokens","target":100}' });
    store.save({ 'kbu.budget.v1': null });
    store.save({ 'kbu.budget.v1': '{"target":999}' }, { onlyMissing: true });
    assert.equal(store.load()['kbu.budget.v1'], null);
    assert.equal(existsSync(join(directory, 'config.json')), false);
    if (process.platform !== 'win32') assert.equal(statSync(join(directory, 'preferences.json')).mode & 0o777, 0o600);
    assert.throws(() => store.save({ apiKey: 'private' }), /Invalid/);
    assert.throws(() => store.save({ 'kbu.poster.avatar.v1': 'https://example.test/avatar' }), /Invalid/);
    const ports = [];
    for (let index = 0; index < 2; index++) {
      local = await startLocalDashboardServer({ launchBrowser: false, serveStatic: false, dataLoader: async () => ({}), preferencesStore: createPreferencesStore(directory) });
      const url = new URL(local.url);
      ports.push(url.port);
      assert.equal((await fetch(`${url.origin}/api/preferences`)).status, 401);
      const auth = await fetch(local.url, { redirect: 'manual' });
      const cookie = auth.headers.get('set-cookie').split(';')[0];
      const response = await fetch(`${url.origin}/api/preferences`, { headers: { Cookie: cookie } });
      assert.deepEqual(await response.json(), store.load());
      const invalid = await fetch(`${url.origin}/api/preferences`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"values":{"apiKey":"private"}}' });
      assert.equal(invalid.status, 400);
      await local.close(); local = null;
    }
    assert.doesNotMatch(readFileSync(join(directory, 'preferences.json'), 'utf8'), /private/);
    writeFileSync(join(directory, 'preferences.json'), '{broken');
    assert.throws(() => store.save({ 'kbu.theme': 'light' }));
    assert.equal(readFileSync(join(directory, 'preferences.json'), 'utf8'), '{broken');
  } finally { await local?.close(); rmSync(directory, { recursive: true, force: true }); }
});
