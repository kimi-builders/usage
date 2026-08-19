import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectAntigravityLocalRuntime, hasAntigravityQuotaPayload, parseAntigravityProcessList,
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
