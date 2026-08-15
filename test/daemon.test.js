import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDaemonStatus, installDaemon, renderDaemonFiles, uninstallDaemon,
} from '../src/daemon.js';
import { loadSyncStatus, runManagedSync } from '../src/sync-runtime.js';

test('daemon descriptors use native per-user schedulers on macOS, Linux, and Windows', () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-daemon-render-'));
  try {
    const common = { home: join(root, 'home'), configDir: join(root, 'config'), intervalMinutes: 20, node: '/opt/node' };
    const mac = renderDaemonFiles({ ...common, platform: 'darwin' });
    assert.match(mac.files[0].content, /<integer>1200<\/integer>/);
    assert.match(mac.files[0].content, /daemon<\/string><string>run/);

    const linux = renderDaemonFiles({ ...common, platform: 'linux' });
    assert.match(linux.files.find((file) => file.path.endsWith('.timer')).content, /OnUnitActiveSec=20min/);
    assert.match(linux.files.find((file) => file.path.endsWith('.service')).content, /daemon run/);

    const windows = renderDaemonFiles({ ...common, platform: 'win32' });
    assert.match(windows.files[0].content, /daemon run/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install and uninstall manage a launchd descriptor without touching user data', () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-daemon-install-'));
  const home = join(root, 'home');
  const configDir = join(root, 'config');
  const calls = [];
  const runner = (command, args) => { calls.push([command, args]); return { status: 0, stdout: '', stderr: '' }; };
  try {
    const installed = installDaemon({ platform: 'darwin', home, configDir, runner, intervalMinutes: 15, node: '/opt/node' });
    assert.equal(installed.status.installed, true);
    assert.equal(installed.status.loaded, true);
    assert.equal(installed.intervalMinutes, 15);
    assert.ok(calls.some(([command, args]) => command === 'launchctl' && args.includes('bootstrap')));
    assert.match(readFileSync(join(home, 'Library', 'LaunchAgents', 'builders.kimi.usage.sync.plist'), 'utf8'), /StartInterval/);

    const removed = uninstallDaemon({ platform: 'darwin', home, configDir, runner });
    assert.equal(removed.installed, false);
    assert.equal(existsSync(join(configDir, 'config.json')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('managed sync records private status and prevents overlapping runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-sync-runtime-'));
  let release;
  const first = runManagedSync({
    configDir: root, trigger: 'test', quiet: true,
    sync: () => new Promise((resolve) => { release = () => resolve({ buckets: 3, sessions: 2, rejected: 0 }); }),
  });
  try {
    await assert.rejects(() => runManagedSync({ configDir: root, sync: async () => ({}) }), /另一次同步/);
    release();
    await first;
    const status = loadSyncStatus({ configDir: root });
    assert.equal(status.state, 'idle');
    assert.equal(status.result.buckets, 3);
    assert.equal(status.result.sessions, 2);
    assert.ok(status.lastSuccessAt);
    assert.equal(getDaemonStatus({ platform: 'darwin', home: join(root, 'home'), configDir: root, runner: () => ({ status: 1 }) }).installed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('managed sync forwards an explicit full-replay confirmation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-sync-runtime-full-'));
  let options;
  try {
    await runManagedSync({
      configDir: root,
      full: true,
      sync: async (value) => { options = value; return { buckets: 0, sessions: 0 }; },
    });
    assert.equal(options.full, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon status exposes safe log hints instead of absolute local paths', () => {
  const root = '/Users/sentinel/private/kbu-config';
  const status = getDaemonStatus({
    platform: 'darwin', home: '/Users/sentinel', configDir: root,
    runner: () => ({ status: 1 }),
  });
  assert.equal(status.logPath, '~/private/kbu-config/sync.log');
  assert.equal(status.schedulerLogPath, '~/private/kbu-config/daemon-scheduler.log');
  assert.equal(status.logAvailable, false);
  assert.equal(JSON.stringify(status).includes('/Users/sentinel'), false);
});

test('sync status persists a generic error while its private log retains diagnostic detail', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-sync-error-'));
  const sentinel = '/Users/sentinel/private/session.json';
  try {
    await assert.rejects(() => runManagedSync({
      configDir: root, trigger: 'test', quiet: true,
      sync: async () => { throw new Error(`could not read ${sentinel}`); },
    }), /could not read/);
    const status = loadSyncStatus({ configDir: root });
    assert.equal(status.lastErrorCode, 'sync_failed');
    assert.equal(status.lastError, 'Synchronization failed. See the private local log for details.');
    assert.equal(JSON.stringify(status).includes(sentinel), false);
    assert.equal(readFileSync(join(root, 'sync-status.json'), 'utf8').includes(sentinel), false);
    assert.equal(readFileSync(join(root, 'sync.log'), 'utf8').includes(sentinel), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon status sanitizes legacy persisted raw errors before exposing them', () => {
  const root = mkdtempSync(join(tmpdir(), 'kbu-daemon-legacy-error-'));
  const sentinel = '/Users/sentinel/private/legacy.json';
  try {
    writeFileSync(join(root, 'sync-status.json'), JSON.stringify({
      state: 'error', lastError: `could not read ${sentinel}`,
    }));
    const status = getDaemonStatus({
      platform: 'darwin', home: join(root, 'home'), configDir: root,
      runner: () => ({ status: 1 }),
    });
    assert.equal(status.lastSync.lastErrorCode, 'sync_failed');
    assert.equal(status.lastSync.lastError, 'Synchronization failed. See the private local log for details.');
    assert.equal(JSON.stringify(status).includes(sentinel), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
