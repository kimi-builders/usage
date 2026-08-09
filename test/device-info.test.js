import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceDisplayName, operatingSystemLabel, terminalLabel } from '../src/device-info.js';

test('device name describes the terminal and OS without a parsed AI source', () => {
  assert.equal(
    deviceDisplayName({
      env: { TERM_PROGRAM: 'iTerm.app' },
      platform: 'darwin',
      arch: 'arm64',
    }),
    'iTerm2 · macOS (arm64)',
  );
});

test('common terminal environments use community-facing names', () => {
  assert.equal(terminalLabel({ TERM_PROGRAM: 'vscode' }), 'VS Code Terminal');
  assert.equal(terminalLabel({ WT_SESSION: 'present', TERM_PROGRAM: 'ignored' }), 'Windows Terminal');
  assert.equal(terminalLabel({}), 'Terminal');
});

test('operating system names do not expose Node platform enums', () => {
  assert.equal(operatingSystemLabel('win32', 'x64'), 'Windows (x64)');
  assert.equal(operatingSystemLabel('linux', ''), 'Linux');
});
