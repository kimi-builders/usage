import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';
import { queryDbJson } from './sqlite.js';

function databasePath() {
  return process.env.KBU_USAGE_ZCODE_DB?.trim()
    || join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
}

export function roots() {
  const path = databasePath();
  try { return existsSync(path) && statSync(path).isFile() ? [path] : []; } catch { return []; }
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function projectName(root, cwd, sessionDir) {
  const value = root || cwd || sessionDir;
  return value ? basename(String(value).replace(/[\\/]+$/, '')) || 'unknown' : 'unknown';
}

export async function parse({ sessionSalt } = {}) {
  const [path] = roots();
  if (!path) return null;
  let rows;
  try {
    rows = queryDbJson(path, `SELECT
      m.session_id AS sessionId,
      m.time_created AS created,
      json_extract(m.data, '$.role') AS role,
      json_extract(m.data, '$.modelID') AS modelId,
      json_extract(m.data, '$.providerID') AS providerId,
      json_extract(m.data, '$.tokens') AS tokens,
      json_extract(m.data, '$.path.root') AS pathRoot,
      json_extract(m.data, '$.path.cwd') AS pathCwd,
      s.directory AS sessionDir
      FROM message m LEFT JOIN session s ON s.id = m.session_id`);
  } catch (error) {
    if (error?.status === 127 || error?.message?.includes('ENOENT')) {
      throw new Error('ZCode requires Node 22.5+ or the sqlite3 CLI.');
    }
    throw error;
  }

  const entries = [];
  const events = [];
  for (const row of rows) {
    const timestamp = new Date(row.created);
    if (Number.isNaN(timestamp.getTime()) || !['user', 'assistant'].includes(row.role)) continue;
    const project = projectName(row.pathRoot, row.pathCwd, row.sessionDir);
    events.push({
      sessionId: row.sessionId || 'unknown', source: 'zcode', project, timestamp,
      role: row.role,
    });
    if (row.role !== 'assistant') continue;
    let tokens;
    try { tokens = typeof row.tokens === 'string' ? JSON.parse(row.tokens) : row.tokens; } catch { continue; }
    if (!tokens || typeof tokens !== 'object') continue;
    const cacheReadInputTokens = count(tokens.cache?.read);
    const cacheWriteInputTokens = count(tokens.cache?.write);
    const reasoningOutputTokens = count(tokens.reasoning);
    // ZCode input includes cache reads but excludes cache writes; output includes reasoning.
    const inputTokens = Math.max(0, count(tokens.input) - cacheReadInputTokens);
    const outputTokens = Math.max(0, count(tokens.output) - reasoningOutputTokens);
    if (inputTokens + cacheWriteInputTokens + cacheReadInputTokens
      + outputTokens + reasoningOutputTokens === 0) continue;
    entries.push({
      source: 'zcode',
      model: row.modelId || 'unknown',
      ...(row.providerId ? { modelProvider: String(row.providerId) } : {}),
      project,
      timestamp,
      inputTokens,
      cacheWriteInputTokens,
      cacheReadInputTokens,
      outputTokens,
      reasoningOutputTokens,
      requestCount: 1,
    });
  }
  return { buckets: aggregateToBuckets(entries), sessions: extractSessions(events, sessionSalt) };
}
