import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
