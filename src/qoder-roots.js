import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Path resolution for the two Qoder editions (same role as the other *-roots.js
// modules: shared by tools.js detection and the parser, free of parser imports).
//
//   edition     CLI config dir   IDE data dir (macOS)
//   'qoder'     ~/.qoder         ~/Library/Application Support/Qoder
//   'qoder-cn'  ~/.qoder-cn      ~/Library/Application Support/QoderCN
//
// Verified upstream against Qoder CLI 1.1.42 (both editions are one bundle branded via
// QODERCLI_SITE) and IDE 1.28.0 product.json / extension code on 2026-09-04.

const DB_RELATIVE = join('SharedClientCache', 'cache', 'db', 'local.db');

export const QODER_EDITIONS = {
  qoder: {
    source: 'qoder',
    label: 'Qoder',
    cliDirName: '.qoder',
    cliEnv: 'QODER_CONFIG_DIR',
    ideDirName: 'Qoder',
    ideHomeEnv: 'QODER_HOME',
    testProjectsEnv: 'KBU_USAGE_QODER_PROJECTS',
    testDbEnv: 'KBU_USAGE_QODER_DB',
  },
  'qoder-cn': {
    source: 'qoder-cn',
    label: 'Qoder CN',
    cliDirName: '.qoder-cn',
    cliEnv: 'QODERCN_CONFIG_DIR',
    ideDirName: 'QoderCN',
    ideHomeEnv: 'QODER_CN_HOME',
    testProjectsEnv: 'KBU_USAGE_QODER_CN_PROJECTS',
    testDbEnv: 'KBU_USAGE_QODER_CN_DB',
  },
};

function expandHome(p) {
  if (!p) return p;
  return p === '~' ? homedir() : /^~[/\\]/.test(p) ? join(homedir(), p.slice(2)) : p;
}

/** CLI/app transcript root: <configDir>/projects. Honors Qoder's own config-dir env. */
export function getQoderProjectsDir(edition) {
  const e = QODER_EDITIONS[edition];
  const test = process.env[e.testProjectsEnv]?.trim();
  if (test) return expandHome(test);
  const cfg = process.env[e.cliEnv]?.trim();
  const root = cfg ? expandHome(cfg) : join(homedir(), e.cliDirName);
  return join(root, 'projects');
}

/** IDE SQLite store. Honors QODER_HOME / QODER_CN_HOME like Qoder's own language server. */
export function getQoderDbPath(edition) {
  const e = QODER_EDITIONS[edition];
  const test = process.env[e.testDbEnv]?.trim();
  if (test) return expandHome(test);
  const home = process.env[e.ideHomeEnv]?.trim();
  if (home) return join(expandHome(home), 'cache', 'db', 'local.db');
  let root;
  if (process.platform === 'darwin') {
    root = join(homedir(), 'Library', 'Application Support', e.ideDirName);
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
    root = join(appData, e.ideDirName);
  } else {
    const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
    root = join(xdg, e.ideDirName);
  }
  return join(root, DB_RELATIVE);
}

/**
 * Installed-detection for tools.js. `~/.qoder` alone proves nothing — the IDE
 * also uses it (product.json dataFolderName) for extensions — so look for the
 * transcript directory or the IDE database specifically.
 */
export function findQoderDataDirs(edition) {
  return [getQoderProjectsDir(edition), getQoderDbPath(edition)].filter(existsSync);
}
