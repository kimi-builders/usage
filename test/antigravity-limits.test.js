import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAntigravityLocalRuntime, fetchAntigravityLocalQuota, hasAntigravityQuotaPayload,
  parseAntigravityProcessList, parseProcNetListeningPorts,
} from '../src/limits/providers/antigravity-local.js';

test('Antigravity runtime detection accepts exact agy and Antigravity language servers only', () => {
  const rows = parseAntigravityProcessList([
    '101 /Users/test/.local/bin/agy',
    '102 /Applications/Antigravity.app/Contents/Resources/language_server --app_data_dir antigravity --csrf_token private',
    '105 /Applications/Antigravity IDE.app/Contents/Resources/language_server_macos_arm --app_data_dir antigravity-ide --csrf_token ide-private',
    '103 /bin/zsh -c mention agy in an argument',
    '104 /usr/local/bin/language_server --app_data_dir unrelated',
  ].join('\n'), 'darwin');
  assert.deepEqual(rows.map((row) => [row.pid, row.kind]), [[101, 'cli'], [102, 'app'], [105, 'ide']]);
  assert.equal(rows[1].csrfToken, 'private');
});

test('Antigravity runtime detection supports the Windows process JSON shape', () => {
  const rows = parseAntigravityProcessList(JSON.stringify([
    { ProcessId: 201, CommandLine: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe' },
    { ProcessId: 202, CommandLine: 'C:\\Windows\\System32\\cmd.exe /c echo agy' },
  ]), 'win32');
  assert.deepEqual(rows.map((row) => [row.pid, row.kind]), [[201, 'cli']]);
});

test('Antigravity detection prefers the app, then agy, then the IDE', () => {
  const run = () => ({ status: 0, stdout: [
    '101 /Users/test/.local/bin/agy',
    '102 /Applications/Antigravity.app/Contents/Resources/language_server --app_data_dir antigravity --csrf_token private',
  ].join('\n') });
  assert.deepEqual(detectAntigravityLocalRuntime({ run, platform: 'darwin' }), {
    found: true, label: 'Antigravity 本机服务', kind: 'app',
  });
});

test('quota payload detection accepts grouped summaries and legacy model configs', () => {
  assert.equal(hasAntigravityQuotaPayload({ response: { groups: [{ buckets: [{ remainingFraction: 0 }] }] } }), true);
  assert.equal(hasAntigravityQuotaPayload({ userStatus: { cascadeModelConfigData: {
    clientModelConfigs: [{ quotaInfo: { remainingFraction: 0.5 } }],
  } } }), true);
  assert.equal(hasAntigravityQuotaPayload({ response: { groups: [{ buckets: [{}] }] } }), false);
});

test('Linux proc parser returns only listening ports owned by the target process', () => {
  const table = [
    'sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode',
    '0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 111111',
    '1: 0100007F:C000 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 999999',
    '2: 0100007F:2328 00000000:0000 01 00000000:00000000 00:00000000 00000000 1000 0 111111',
  ].join('\n');
  assert.deepEqual([...parseProcNetListeningPorts(table, new Set(['111111']))], [8080]);
});

test('Antigravity Linux discovery falls back to process-owned proc sockets when lsof is unavailable', async (t) => {
  const procRoot = mkdtempSync(join(tmpdir(), 'usage-antigravity-proc-'));
  t.after(() => rmSync(procRoot, { recursive: true, force: true }));
  mkdirSync(join(procRoot, '42', 'fd'), { recursive: true });
  mkdirSync(join(procRoot, '42', 'net'), { recursive: true });
  symlinkSync('socket:[111111]', join(procRoot, '42', 'fd', '7'));
  writeFileSync(join(procRoot, '42', 'net', 'tcp'), [
    'sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode',
    '0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 111111',
  ].join('\n'));
  const requests = [];
  const result = await fetchAntigravityLocalQuota({
    platform: 'linux', procRoot,
    run: (command) => command === 'ps'
      ? { status: 0, stdout: '42 /usr/local/bin/agy\n' }
      : { status: 1, stdout: '' },
    requester: async (request) => {
      requests.push(request);
      return { response: { groups: [{ buckets: [{ remainingFraction: 0.5 }] }] } };
    },
  });
  assert.equal(result.source, 'agy 本机服务');
  assert.equal(requests[0].port, 8080);
});
