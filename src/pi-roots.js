import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

function expandHome(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function existingDirectories(paths) {
  return [...new Set(paths.map(expandHome).filter(Boolean))].filter((path) => {
    try { return existsSync(path) && statSync(path).isDirectory(); } catch { return false; }
  });
}

function looksLikeOmpAgentDir(agentDir) {
  const normalized = agentDir.replace(/\\/g, '/');
  return normalized.includes('/.omp/')
    || existsSync(join(agentDir, 'config.yml'))
    || existsSync(join(agentDir, 'agent.db'));
}

export function piSessionRoots() {
  const override = process.env.KBU_USAGE_PI_SESSION_DIRS;
  if (override !== undefined) return existingDirectories(override.split(delimiter));

  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) {
    const expanded = expandHome(agentDir);
    // Oh My Pi inherits PI_CODING_AGENT_DIR. Until OMP has its own parser, do
    // not silently mislabel an identifiable OMP store as the official Pi agent.
    if (looksLikeOmpAgentDir(expanded)) return [];
    return existingDirectories([join(expanded, 'sessions')]);
  }
  return existingDirectories([join(homedir(), '.pi', 'agent', 'sessions')]);
}
