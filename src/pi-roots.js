import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { configuredExtraRoots } from './extra-roots.js';

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

function configuredSessionDir(agentDir) {
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8'));
    const value = expandHome(settings?.sessionDir);
    return value && isAbsolute(value) ? value : '';
  } catch {
    return '';
  }
}

export function piSessionRoots(sourceOptions = {}) {
  const override = process.env.KBU_USAGE_PI_SESSION_DIRS;
  if (override !== undefined) return existingDirectories(override.split(delimiter));

  const directOverride = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (directOverride) {
    return existingDirectories([
      directOverride,
      ...configuredExtraRoots(sourceOptions, 'pi-coding-agent'),
    ]);
  }

  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) {
    const expanded = expandHome(agentDir);
    // Oh My Pi inherits PI_CODING_AGENT_DIR. Until OMP has its own parser, do
    // not silently mislabel an identifiable OMP store as the official Pi agent.
    if (looksLikeOmpAgentDir(expanded)) {
      return existingDirectories(configuredExtraRoots(sourceOptions, 'pi-coding-agent'));
    }
    return existingDirectories([
      configuredSessionDir(expanded) || join(expanded, 'sessions'),
      ...configuredExtraRoots(sourceOptions, 'pi-coding-agent'),
    ]);
  }
  const defaultAgentDir = join(homedir(), '.pi', 'agent');
  return existingDirectories([
    configuredSessionDir(defaultAgentDir) || join(defaultAgentDir, 'sessions'),
    ...configuredExtraRoots(sourceOptions, 'pi-coding-agent'),
  ]);
}
