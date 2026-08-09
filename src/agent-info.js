import { spawnSync } from 'node:child_process';

const AGENT_COMMANDS = [
  { source: 'kimi-code', commands: [['kimi-cli', '--version'], ['kimi', '--version']] },
  { source: 'claude-code', commands: [['claude', '--version']] },
  { source: 'codex', commands: [['codex', '--version']] },
  { source: 'opencode', commands: [['opencode', '--version']] },
  { source: 'gemini-cli', commands: [['gemini', '--version']] },
  { source: 'copilot-cli', commands: [['copilot', '--version']] },
];

export function versionFromOutput(output) {
  const text = String(output || '').trim().split(/\r?\n/, 1)[0] || '';
  const match = text.match(/v?(\d+(?:\.\d+){1,4}(?:[-+.][0-9A-Za-z.-]+)?)/);
  return match?.[1] || '';
}

export function detectAgentVersions({ run = spawnSync } = {}) {
  const versions = {};
  for (const agent of AGENT_COMMANDS) {
    for (const [command, ...args] of agent.commands) {
      let result;
      try {
        result = run(command, args, {
          encoding: 'utf8',
          timeout: 2_000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        continue;
      }
      const version = versionFromOutput(`${result?.stdout || ''}\n${result?.stderr || ''}`);
      if (version) {
        versions[agent.source] = version;
        break;
      }
    }
  }
  return versions;
}
