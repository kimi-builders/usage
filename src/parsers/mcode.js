import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets } from './index.js';
import { queryDbJsonSnapshotOnLock } from './sqlite.js';

const TOKEN_COLUMNS = [
  'session_id', 'model', 'ts', 'input_tokens', 'output_tokens',
  'reasoning_tokens', 'cache_read_tokens', 'cache_write_tokens',
];
const SESSION_COLUMNS = ['session_id', 'workspace_dir', 'project_workspace_dir'];
const USAGE_SQL = `SELECT ${TOKEN_COLUMNS.map((column) => `token.${column}`).join(', ')},
  session.workspace_dir, session.project_workspace_dir
  FROM local_runtime_token_usage AS token
  LEFT JOIN local_runtime_sessions AS session ON session.session_id = token.session_id`;

const MAX_WARNINGS = 20;
const MCODE_DB_RELATIVE = join('v2', 'sqlite', 'runtime-state.sqlite');

// Data-root variables the mcode CLI itself resolves, in its own precedence.
// MCODE_HOME stays first as this project's pre-existing fixture override,
// then the two public relocation variables the CLI documents.
const MCODE_ROOT_ENV = ['MCODE_HOME', 'MINIMAX_DATA_DIR', 'MAVIS_DATA_DIR'];

function mcodeRootFromEnv(env) {
  for (const key of MCODE_ROOT_ENV) {
    const value = env[key]?.trim();
    if (!value) continue;
    if (!isAbsolute(value)) {
      throw new Error(`${key} must be an absolute path.`);
    }
    return value;
  }
  return null;
}

export function resolveMcodeDbPath(env = process.env, home = homedir()) {
  const override = env.KBU_USAGE_MCODE_DB?.trim();
  if (override) return isAbsolute(override) ? override : resolve(override);
  const root = mcodeRootFromEnv(env) || join(home, '.minimax');
  return join(root, MCODE_DB_RELATIVE);
}

/**
 * Every mcode store worth reading.
 *
 * The mcode CLI relocates its whole data root with MINIMAX_DATA_DIR /
 * MAVIS_DATA_DIR, scopes it to ~/.minimax-<profile> when a profile is active,
 * and earlier source builds kept user data at ~/.minimax-code; the pre-rename
 * home (~/.mavis) stays readable through the CLI's own compat link. Reading
 * only ~/.minimax silently misses every session written in those layouts.
 *
 * An explicit override keeps returning its single unresolved path so a missing
 * file still yields an empty result; the default layout only returns stores
 * that exist, deduplicated by physical file so a compat symlink cannot make
 * the same ledger count twice.
 */
export function resolveMcodeDbPaths(env = process.env, home = homedir()) {
  if (env.KBU_USAGE_MCODE_DB?.trim() || mcodeRootFromEnv(env)) {
    return [resolveMcodeDbPath(env, home)];
  }
  const candidates = [
    join(home, '.minimax'),
    join(home, '.minimax-code'),
    join(home, '.mavis'),
  ];
  try {
    const profiles = readdirSync(home, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\.(?:minimax|mavis)-.+$/.test(entry.name))
      .map((entry) => join(home, entry.name))
      .sort();
    candidates.push(...profiles);
  } catch {
    // Unreadable home directory: fall back to the default layout below.
  }
  const paths = [];
  const seen = new Set();
  for (const dir of candidates) {
    const dbPath = join(dir, MCODE_DB_RELATIVE);
    if (!existsSync(dbPath)) continue;
    let identity = dbPath;
    try { identity = realpathSync(dbPath); } catch { /* keep the literal path */ }
    if (seen.has(identity)) continue;
    seen.add(identity);
    paths.push(dbPath);
  }
  return paths;
}

export function roots() {
  return resolveMcodeDbPaths().filter((path) => {
    try { return existsSync(path) && statSync(path).isFile(); } catch { return false; }
  });
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function timestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const date = new Date(number < 1e12 ? number * 1000 : number);
  return Number.isNaN(date.getTime()) ? null : date;
}

function projectFromPath(value) {
  return basename(String(value || '').replace(/[\\/]+$/, '')) || 'unknown';
}

function hasColumns(path, table, columns) {
  const rows = queryDbJsonSnapshotOnLock(path, `PRAGMA table_info(${table})`, {
    tempPrefix: 'kbu-mcode',
  });
  const present = new Set(rows.map((row) => String(row.name)));
  return columns.every((column) => present.has(column));
}

function isSqliteUnavailableError(error) {
  return error?.status === 127 || /ENOENT/.test(error?.message || '');
}

export async function parse() {
  const paths = roots();
  if (paths.length === 0) return null;
  const entries = [];
  const warnings = [];
  const warn = (message) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(`mcode: ${message}`);
  };
  // mcode's own migration can COPY a relocated legacy tree into ~/.minimax, so
  // both copies exist. Collapse rows that reappear unchanged in a later store;
  // duplicates inside one store are left alone — there they are the ledger.
  const seenAcrossStores = new Set();
  for (const path of paths) {
    // The first store that exists is the one the running CLI would use; schema
    // or read failures there keep the fail-soft contract below. Later stores
    // are best-effort extras (profiles, old homes) and a broken one must not
    // blank the live store.
    const isPrimary = path === paths[0];

    // Schema guard: every allow-listed column must exist. If the mcode
    // runtime ever renames / drops a column, fail soft (skipped) so the
    // incremental sync keeps the last good upload state for this source.
    let schemaOk;
    try {
      schemaOk = hasColumns(path, 'local_runtime_token_usage', TOKEN_COLUMNS)
        && hasColumns(path, 'local_runtime_sessions', SESSION_COLUMNS);
    } catch (error) {
      if (isSqliteUnavailableError(error)) {
        throw new Error('MiniMax Code requires Node 22.5+ or the sqlite3 CLI.');
      }
      schemaOk = false;
    }
    if (!schemaOk) {
      if (isPrimary) return { buckets: [], sessions: [], skipped: true };
      warn(`skipping incompatible database ${path}`);
      continue;
    }

    let rows;
    try {
      rows = queryDbJsonSnapshotOnLock(path, USAGE_SQL, { tempPrefix: 'kbu-mcode' });
    } catch (error) {
      if (isSqliteUnavailableError(error)) {
        throw new Error('MiniMax Code requires Node 22.5+ or the sqlite3 CLI.');
      }
      if (isPrimary) return { buckets: [], sessions: [], skipped: true };
      warn(`cannot read ${path}: ${error?.message || error}`);
      continue;
    }

    const identitiesInStore = new Set();
    for (const row of rows) {
      // Identity covers every selected column; only a byte-identical ledger
      // row can collapse, and only against an earlier store.
      const identity = JSON.stringify(row);
      if (seenAcrossStores.has(identity)) continue;
      identitiesInStore.add(identity);
      if (!row.session_id) continue;
      const date = timestamp(row.ts);
      if (!date) continue;
      const inputTokens = count(row.input_tokens);
      const cacheWriteInputTokens = count(row.cache_write_tokens);
      const cacheReadInputTokens = count(row.cache_read_tokens);
      const outputTokens = count(row.output_tokens);
      const reasoningOutputTokens = count(row.reasoning_tokens);
      if (inputTokens + cacheWriteInputTokens + cacheReadInputTokens
        + outputTokens + reasoningOutputTokens === 0) continue;
      entries.push({
        source: 'mcode',
        model: String(row.model || '').trim() || 'unknown',
        project: projectFromPath(row.project_workspace_dir || row.workspace_dir),
        timestamp: date,
        inputTokens,
        cacheWriteInputTokens,
        cacheReadInputTokens,
        outputTokens,
        reasoningOutputTokens,
        requestCount: 1,
      });
    }
    for (const identity of identitiesInStore) seenAcrossStores.add(identity);
  }
  return {
    buckets: aggregateToBuckets(entries),
    sessions: [],
    ...(warnings.length > 0 ? { skipped: true, warnings } : {}),
  };
}
