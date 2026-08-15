import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDashboardControl } from '../src/local/dashboard-control.js';

const registry = [
  { id: 'kimi-code', tier: 'core', roots: async () => ['/kimi'] },
  { id: 'codex', tier: 'stable', roots: async () => [] },
];

test('dashboard control supports onboarding, browser connection, deletion, and disconnect', async () => {
  let config = null;
  let cleared = 0;
  let uninstalled = 0;
  const control = createDashboardControl({
    configLoader: () => config,
    configSaver: (next) => { config = next; },
    registry,
    daemonStatus: () => ({ installed: true, supported: true }),
    daemonUninstaller: () => { uninstalled += 1; },
    stateClearer: () => { cleared += 1; },
    deviceCodeRequester: async () => ({
      deviceCode: 'device-code', userCode: 'ABCD-EFGH',
      verificationUri: 'https://kimi.builders/usage/device',
      verificationUriComplete: 'https://kimi.builders/usage/device?code=ABCD-EFGH',
      expiresIn: 600, interval: 1,
    }),
    deviceTokenPoller: async () => ({ apiKey: `kbu_${'a'.repeat(43)}`, deviceId: 'device-id' }),
    settingsFetcher: async () => ({ uploadProject: false }),
    remoteDataDeleter: async () => ({ ok: true, deleted: { buckets: 3 } }),
    now: () => Date.parse('2026-08-14T10:00:00.000Z'),
  });

  const initial = await control.state();
  assert.equal(initial.onboardingRequired, true);
  assert.deepEqual(initial.sources.map(({ id, detected }) => ({ id, detected })), [
    { id: 'kimi-code', detected: true }, { id: 'codex', detected: false },
  ]);

  const completed = await control.act({
    action: 'complete-onboarding', sourcePolicies: { 'kimi-code': 'local', codex: 'off' },
  });
  assert.equal(completed.onboardingRequired, false);
  assert.equal(config.sourcePolicies['kimi-code'], 'local');
  assert.equal(config.apiKey, undefined);

  const pending = await control.act({ action: 'connect-start' });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.userCode, 'ABCD-EFGH');
  const connected = await control.act({ action: 'connect-poll' });
  assert.equal(connected.status, 'connected');
  assert.equal(connected.community.connected, true);
  assert.equal(config.sourcePolicies['kimi-code'], 'local');

  const deleted = await control.act({ action: 'delete-device-data' });
  assert.equal(deleted.result.deleted.buckets, 3);
  assert.equal(cleared, 1);

  const disconnected = await control.act({ action: 'disconnect' });
  assert.equal(disconnected.community.connected, false);
  assert.equal(config.apiKey, undefined);
  assert.equal(config.sourcePolicies['kimi-code'], 'local');
  assert.equal(uninstalled, 1);
});

test('opening Dashboard freezes legacy coverage so future agents stay local-only', async () => {
  let config = { apiKey: 'kbu_fixture', sessionSalt: 'x'.repeat(32) };
  const control = createDashboardControl({
    configLoader: () => config,
    configSaver: (next) => { config = next; },
    registry,
    daemonStatus: () => ({ installed: false, supported: true }),
  });
  const state = await control.state();
  assert.equal(state.onboardingRequired, false);
  assert.deepEqual(config.sourcePolicies, { 'kimi-code': 'private', codex: 'private' });
  assert.equal(config.sourcePolicyVersion, 1);
});

test('Dashboard validates and stores the Cursor CSV before enabling scan modes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-cursor-control-'));
  const csvPath = join(directory, 'cursor-usage.csv');
  writeFileSync(csvPath, 'Date,Model,Tokens\n2026-08-14,cursor,10\n');
  let config = null;
  const cursorRegistry = [{
    id: 'cursor', tier: 'explicit-opt-in',
    roots: async ({ sourceOptions }) => sourceOptions?.cursor?.csvPath ? [sourceOptions.cursor.csvPath] : [],
  }];
  const control = createDashboardControl({
    configLoader: () => config,
    configSaver: (next) => { config = next; },
    registry: cursorRegistry,
    daemonStatus: () => ({ installed: false, supported: true }),
  });
  try {
    const initial = await control.state();
    assert.equal(initial.sources[0].configuration.configured, false);
    assert.equal(initial.sources[0].mode, 'off');

    const configured = await control.act({ action: 'configure-source', sourceId: 'cursor', csvPath });
    assert.equal(configured.sources[0].configuration.configured, true);
    assert.equal('value' in configured.sources[0].configuration, false);
    assert.equal(JSON.stringify(configured).includes(csvPath), false);
    assert.equal(configured.sources[0].detected, true);
    assert.equal(config.sourceOptions.cursor.csvPath, csvPath);
    assert.equal(config.sourcePolicies.cursor, 'off');

    await assert.rejects(
      control.act({ action: 'configure-source', sourceId: 'cursor', csvPath: join(directory, 'missing.csv') }),
      (error) => error.code === 'invalid_control_input',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
