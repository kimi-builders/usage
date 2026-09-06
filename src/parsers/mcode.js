import { existsSync, statSync } from 'node:fs';
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

export function resolveMcodeDbPath(env = process.env, home = homedir()) {
  const override = env.KBU_USAGE_MCODE_DB?.trim();
  if (override) return isAbsolute(override) ? override : resolve(override);
  if (env.MCODE_HOME && !isAbsolute(env.MCODE_HOME)) {
    throw new Error('MCODE_HOME must be an absolute path.');
  }
  return join(env.MCODE_HOME || join(home, '.minimax'), 'v2', 'sqlite', 'runtime-state.sqlite');
}

export function roots() {
  const path = resolveMcodeDbPath();
  try { return existsSync(path) && statSync(path).isFile() ? [path] : []; } catch { return []; }
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

export async function parse() {
  const [path] = roots();
  if (!path) return null;
  try {
    if (!hasColumns(path, 'local_runtime_token_usage', TOKEN_COLUMNS)
      || !hasColumns(path, 'local_runtime_sessions', SESSION_COLUMNS)) {
      return { buckets: [], sessions: [], skipped: true };
    }
    const entries = queryDbJsonSnapshotOnLock(path, USAGE_SQL, { tempPrefix: 'kbu-mcode' })
      .flatMap((row) => {
        if (!row.session_id) return [];
        const date = timestamp(row.ts);
        if (!date) return [];
        const inputTokens = count(row.input_tokens);
        const cacheWriteInputTokens = count(row.cache_write_tokens);
        const cacheReadInputTokens = count(row.cache_read_tokens);
        const outputTokens = count(row.output_tokens);
        const reasoningOutputTokens = count(row.reasoning_tokens);
        if (inputTokens + cacheWriteInputTokens + cacheReadInputTokens
          + outputTokens + reasoningOutputTokens === 0) return [];
        return [{
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
        }];
      });
    return { buckets: aggregateToBuckets(entries), sessions: [] };
  } catch (error) {
    if (error?.status === 127 || /ENOENT/.test(error?.message || '')) {
      throw new Error('MiniMax Code requires Node 22.5+ or the sqlite3 CLI.');
    }
    return { buckets: [], sessions: [], skipped: true };
  }
}
