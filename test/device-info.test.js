import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deviceDisplayName,
  deviceEnvironment,
  operatingSystemLabel,
  terminalInfo,
  terminalLabel,
} from '../src/device-info.js';

test('device name describes the terminal and OS without a parsed AI source', () => {
  assert.equal(
    deviceDisplayName({
      env: { TERM_PROGRAM: 'iTerm.app' },
      platform: 'darwin',
      arch: 'arm64',
    }),
    'iTerm2 · macOS',
  );
});

test('terminal and OS versions stay in separate factual fields', () => {
  assert.deepEqual(
    deviceEnvironment({
      env: { TERM_PROGRAM: 'WarpTerminal', TERM_PROGRAM_VERSION: 'v0.2026.07.29.09.05.stable_02' },
      platform: 'darwin',
      arch: 'arm64',
      version: '26.5.2',
    }),
    {
      terminal: {
        name: 'Warp',
        version: 'v0.2026.07.29.09.05.stable_02',
        confidence: 'detected',
      },
      os: { name: 'macOS', version: '26.5.2', architecture: 'arm64' },
    },
  );
  assert.deepEqual(terminalInfo({ TERM_PROGRAM: 'WarpTerminal' }), {
    name: 'Warp',
    version: '',
    confidence: 'detected',
  });
});

test('common terminal environments use community-facing names', () => {
  assert.equal(terminalLabel({ TERM_PROGRAM: 'vscode' }), 'VS Code Terminal');
  assert.equal(terminalLabel({ WT_SESSION: 'present', TERM_PROGRAM: 'ignored' }), 'Windows Terminal');
  assert.equal(terminalLabel({}), 'CLI');
});

test('operating system names do not expose Node platform enums', () => {
  assert.equal(operatingSystemLabel('win32', 'x64'), 'Windows (x64)');
  assert.equal(operatingSystemLabel('linux', ''), 'Linux');
});
