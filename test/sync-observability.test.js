import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { installDaemonRuntime } from '../src/daemon-runtime.js';
import { renderDaemonFiles } from '../src/daemon.js';
import { runManagedSync, loadSyncStatus } from '../src/sync-runtime.js';
import { estimateSyncRemainingMs, publicSyncProgress, publicSyncResult } from '../src/sync-progress.js';
import { fetchAccount, ingest } from '../src/api.js';
import { createDashboardControl } from '../src/local/dashboard-control.js';
import { effectiveSourcePolicies } from '../src/source-policy.js';

test('partial sync retains last full success, private diagnostics, and sanitized live progress', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-progress-'));
  try {
    await runManagedSync({ configDir: root, sync: async () => ({ buckets: 2 }) });
    const previous = loadSyncStatus({ configDir: root }).lastSuccessAt;
    await runManagedSync({ configDir: root, sync: async ({ onProgress }) => {
      onProgress({ phase: 'retrying', totalBatches: 3, completedBatches: 1, retryDelayMs: 1000, secret: 'never expose' });
      const current = loadSyncStatus({ configDir: root });
      assert.equal(current.state, 'running');
      assert.equal(current.progress.retryDelayMs, 1000);
      assert.equal(JSON.stringify(current).includes('never expose'), false);
      return { buckets: 1, sources: [{ source: 'codex', status: 'partial', warnings: ['private-path-warning'] }] };
    } });
    const partial = loadSyncStatus({ configDir: root });
    assert.equal(partial.state, 'partial');
    assert.equal(partial.lastSuccessAt, previous);
    assert.equal(partial.result.sources[0].warningCount, 1);
    assert.equal(JSON.stringify(partial).includes('private-path'), false);
    assert.match(readFileSync(join(root, 'sync.log'), 'utf8'), /private-path-warning/);
    await runManagedSync({ configDir: root, sync: async () => ({ rejected: 1 }) });
    assert.equal(loadSyncStatus({ configDir: root }).state, 'partial');
    await runManagedSync({ configDir: root, sync: async () => ({}) });
    assert.equal(loadSyncStatus({ configDir: root }).state, 'idle');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ETA needs acknowledged samples and never manufactures a scan percentage', () => {
  assert.equal(estimateSyncRemainingMs(1000, 0, 4), null);
  assert.equal(estimateSyncRemainingMs(1000, 1, 4), 3000);
  assert.equal(estimateSyncRemainingMs(1000, 4, 4), null);
  assert.equal(publicSyncProgress({ phase: 'scanning' }).remainingMs, null);
  assert.equal(publicSyncResult({ compressedBytes: 2048 }).compressedBytes, 2048);
});

test('managed runtime survives source/cache removal, stays version-pinned, and renders on three schedulers', () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-runtime-'));
  try {
    const source = join(root, 'npm cache 模拟');
    mkdirSync(join(source, 'bin'), { recursive: true }); mkdirSync(join(source, 'src'));
    writeFileSync(join(source, 'package.json'), JSON.stringify({ type: 'module', version: '1.2.3' }));
    writeFileSync(join(source, 'src', 'version.js'), 'export default "1.2.3";');
    writeFileSync(join(source, 'bin', 'kbu-usage.js'), 'import version from "../src/version.js"; console.log(version);');
    const configDir = join(root, 'private config');
    const entry = installDaemonRuntime(configDir, source);
    assert.equal(installDaemonRuntime(configDir, source), entry);
    renameSync(source, join(root, 'cache removed'));
    const child = spawnSync(process.execPath, [entry], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), '1.2.3');
    for (const platform of ['darwin', 'linux', 'win32']) {
      const rendered = renderDaemonFiles({ platform, home: root, configDir, entry });
      assert.equal(rendered.paths.entry, entry);
      const renderedEntry = platform === 'linux' ? entry.replaceAll('\\', '\\\\') : entry;
      assert.ok(rendered.files.some(f => f.content.includes(renderedEntry)));
      assert.ok(rendered.files.every(f => !f.content.includes('@latest') && !f.content.includes('npm cache')));
    }

    const windowsEntry = String.raw`C:\Users\builder\AppData\Local\Kimi Builders\runtime\bin\kbu-usage.js`;
    const linuxFromWindows = renderDaemonFiles({
      platform: 'linux', home: root, configDir, entry: windowsEntry,
    });
    assert.ok(linuxFromWindows.files.some(f => f.content.includes(windowsEntry.replaceAll('\\', '\\\\'))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('community identity lookup degrades on old/offline servers and does not follow credential redirects', async () => {
  let mode = 'success'; let redirects = 0;
  const server = createServer((request, response) => {
    if (request.url === '/elsewhere') { redirects++; response.end('{}'); return; }
    assert.equal(request.url, '/api/usage/device/current');
    if (mode === 'redirect') { response.writeHead(302, { Location: '/elsewhere' }); response.end(); return; }
    response.writeHead(mode === 'missing' ? 404 : mode === 'unauthorized' ? 401 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(mode === 'success' ? { account: { handle: 'builder\n', name: 'Name', email: 'private@example.com' } } : { error: { message: 'unavailable' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await fetchAccount(url, 'fixture-key'), { status: 'verified', account: { handle: 'builder', name: 'Name' } });
    for (const [value, expected] of [['missing', 'unavailable'], ['unauthorized', 'unauthorized'], ['redirect', 'unavailable']]) {
      mode = value; assert.equal((await fetchAccount(url, 'fixture-key')).status, expected);
    }
    assert.equal(redirects, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal((await fetchAccount(url, 'fixture-key')).status, 'unavailable');
});

test('retry progress counts acknowledgements, not attempts', async () => {
  let count = 0; const progress = [];
  const server = createServer((request, response) => {
    request.resume(); count++;
    response.writeHead(count === 1 ? 429 : 200, { 'Content-Type': 'application/json', 'Retry-After': '0' });
    response.end(JSON.stringify(count === 1 ? { error: 'limited' } : { ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await ingest(`http://127.0.0.1:${server.address().port}`, 'fixture', {}, { onProgress: p => progress.push(p) });
    assert.deepEqual(progress.map(p => p.phase), ['uploading', 'retrying', 'uploading']);
    assert.equal(progress[1].retryDelayMs, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('dashboard identity never survives a device credential change or performs a lookup on local-only reads', async () => {
  let config = { apiUrl: 'https://kimi.builders', apiKey: 'key-a', sessionSalt: 'a'.repeat(32), sourcePolicies: {} };
  let lookups = 0;
  const control = createDashboardControl({
    configLoader: () => config, configSaver: next => { config = next; }, registry: [],
    daemonStatus: () => ({ installed: false }),
    accountFetcher: async () => { lookups++; return { status: 'verified', account: { handle: 'builder', name: null } }; },
  });
  await control.state(); assert.equal(lookups, 0);
  const refreshed = await control.act({ action: 'refresh-account' });
  assert.equal(refreshed.community.identity.account.handle, 'builder');
  config = { ...config, apiKey: 'key-b' };
  assert.equal((await control.state()).community.identity, null);
  assert.equal(JSON.stringify(config).includes('builder"'), false);
});

test('new Beta sources remain local-only under existing explicit upload policies', () => {
  const policies = effectiveSourcePolicies({ apiKey: 'key', sessionSalt: 's'.repeat(32), sourcePolicies: { codex: 'private' } });
  for (const id of ['qoder', 'qoder-cn', 'dsh']) assert.equal(policies[id], 'local');
  assert.equal(policies.codex, 'private');
});
