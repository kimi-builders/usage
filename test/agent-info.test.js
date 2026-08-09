import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAgentVersions, versionFromOutput } from '../src/agent-info.js';

test('Agent CLI version output is normalized without losing prerelease detail', () => {
  assert.equal(versionFromOutput('codex-cli 0.146.1'), '0.146.1');
  assert.equal(versionFromOutput('kimi, version 1.44.0'), '1.44.0');
  assert.equal(versionFromOutput('v2.1.220-beta.1 (Claude Code)'), '2.1.220-beta.1');
});

test('Agent version detection uses source-specific commands and skips missing tools', () => {
  const outputs = new Map([
    ['kimi-cli --version', 'kimi, version 1.44.0'],
    ['claude --version', '2.1.220 (Claude Code)'],
    ['codex --version', 'codex-cli 0.146.1'],
  ]);
  const versions = detectAgentVersions({
    run(command, args) {
      return { stdout: outputs.get([command, ...args].join(' ')) || '', stderr: '' };
    },
  });
  assert.deepEqual(versions, {
    'kimi-code': '1.44.0',
    'claude-code': '2.1.220',
    codex: '0.146.1',
  });
});
