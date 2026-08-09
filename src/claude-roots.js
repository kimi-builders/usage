import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

const MAX_DESKTOP_DISCOVERY_DEPTH = 8;
const DESKTOP_NON_SESSION_DIRS = new Set(['rpm', 'skills']);

function expandHome(value) {
  const trimmed = value.trim().replace(/[/\\]+$/, '');
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function hasClaudeData(root) {
  return existsSync(join(root, 'projects')) || existsSync(join(root, 'transcripts'));
}

function defaultClaudeDesktopDataDir() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Claude');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    return appData
      ? join(expandHome(appData), 'Claude')
      : join(homedir(), 'AppData', 'Roaming', 'Claude');
  }
  const configHome = process.env.XDG_CONFIG_HOME?.trim();
  return join(configHome ? expandHome(configHome) : join(homedir(), '.config'), 'Claude');
}

function desktopDataDirs() {
  const override = process.env.KBU_USAGE_CLAUDE_DESKTOP_DIRS;
  if (override !== undefined) {
    return override.split(delimiter).map(expandHome).filter(Boolean);
  }
  return [defaultClaudeDesktopDataDir()];
}

function discoverDesktopRoots(dir, depth, roots, onWarning) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      onWarning(`Claude Desktop: cannot read directory ${dir}: ${error.message}`);
    }
    return;
  }
  const claude = entries.find((entry) => entry.name === '.claude' && entry.isDirectory());
  if (claude) {
    roots.push(join(dir, claude.name));
    return;
  }
  if (depth >= MAX_DESKTOP_DISCOVERY_DEPTH) return;
  for (const entry of entries) {
    if (!entry.isDirectory() || DESKTOP_NON_SESSION_DIRS.has(entry.name)) continue;
    discoverDesktopRoots(join(dir, entry.name), depth + 1, roots, onWarning);
  }
}

export function findClaudeDesktopRoots(
  dataDirs = desktopDataDirs(),
  onWarning = () => {},
) {
  const roots = [];
  for (const dataDir of dataDirs) {
    discoverDesktopRoots(join(dataDir, 'local-agent-mode-sessions'), 0, roots, onWarning);
  }
  return roots;
}

export function getClaudeRoots({ onWarning = () => {} } = {}) {
  const override = process.env.KBU_USAGE_CLAUDE_DIRS;
  let candidates;
  if (override !== undefined) {
    candidates = override.split(delimiter).map(expandHome).filter(Boolean);
  } else {
    const home = homedir();
    candidates = [join(home, '.claude')];
    const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
    if (configured) candidates.push(expandHome(configured));
    try {
      for (const entry of readdirSync(home, { withFileTypes: true })) {
        if (!/^\.claude-.+/.test(entry.name)) continue;
        const candidate = join(home, entry.name);
        if (hasClaudeData(candidate)) candidates.push(candidate);
      }
    } catch {
      // Default/configured roots remain usable when HOME cannot be listed.
    }
    candidates.push(...findClaudeDesktopRoots(desktopDataDirs(), onWarning));
  }

  const seen = new Set();
  const roots = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let canonical;
    try {
      canonical = realpathSync(candidate);
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    roots.push(candidate);
  }
  return roots;
}
