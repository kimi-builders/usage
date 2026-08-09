import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';
import { queryDbJson } from './sqlite.js';

/**
 * OpenCode parser (sst/opencode).
 *
 * Data dir: KBU_USAGE_OPENCODE_DIR (test hook / custom installs), else
 * $XDG_DATA_HOME/opencode, else ~/.local/share/opencode. Two stores:
 *
 * 1. Current (opencode >= v0.2): <dir>/opencode.db — a SQLite database whose
 *    `message` table keeps one JSON document per message. Usage lives at
 *    data.tokens {input, output, reasoning, cache:{read, write}}; `input` is
 *    already the uncached input count, so the fields map straight onto our
 *    mutually-exclusive contract (cache.write → cacheWriteInputTokens).
 * 2. Legacy: <dir>/storage/message/ses_*&#47;*.json — one JSON object per
 *    message with the same shape.
 *
 * The SQLite path is tried first; if the DB is unreadable — including the
 * case where neither node:sqlite nor the sqlite3 CLI exists — the parser
 * falls back to the legacy JSON tree instead of failing the source. A DB
 * that parsed is never combined with the JSON tree, so the two cannot
 * double-count.
 */

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
function resolveDataDir() {
  const override = process.env.KBU_USAGE_OPENCODE_DIR?.trim();
  if (override) return override;
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return join(xdg, 'opencode');
  return join(homedir(), '.local', 'share', 'opencode');
}

export function roots() {
  const dir = resolveDataDir();
  return existsSync(dir) ? [dir] : [];
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

// data.tokens → our mutually-exclusive 5-field contract. OpenCode's `input`
// is the uncached input count, so nothing needs subtracting.
function mapTokens(tokens) {
  const inputTokens = tokenCount(tokens.input);
  const cacheWriteInputTokens = tokenCount(tokens.cache?.write);
  const cacheReadInputTokens = tokenCount(tokens.cache?.read);
  const outputTokens = tokenCount(tokens.output);
  const reasoningOutputTokens = tokenCount(tokens.reasoning);
  if (!inputTokens && !cacheWriteInputTokens && !cacheReadInputTokens
    && !outputTokens && !reasoningOutputTokens) return null;
  return { inputTokens, cacheWriteInputTokens, cacheReadInputTokens, outputTokens, reasoningOutputTokens };
}

function projectFromRoot(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath) return 'unknown';
  return basename(rootPath.replace(/[/\\]+$/, '')) || 'unknown';
}

function parseFromSqlite(dbPath) {
  const rows = queryDbJson(dbPath, `SELECT
    session_id as sessionID,
    json_extract(data, '$.role') as role,
    json_extract(data, '$.time.created') as created,
    json_extract(data, '$.modelID') as modelID,
    json_extract(data, '$.providerID') as modelProvider,
    json_extract(data, '$.variant') as reasoningEffort,
    json_extract(data, '$.tokens') as tokens,
    json_extract(data, '$.path.root') as rootPath
    FROM message`);

  const entries = [];
  const sessionEvents = [];
  for (const row of rows) {
    // time.created is integer milliseconds. Invalid → skip the row entirely;
    // never stamp "now" (a stateless parser would re-key it on every sync).
    const timestamp = new Date(row.created);
    if (isNaN(timestamp.getTime())) continue;

    const project = projectFromRoot(row.rootPath);
    sessionEvents.push({
      sessionId: row.sessionID || 'unknown',
      source: 'opencode',
      project,
      timestamp,
      role: row.role === 'user' ? 'user' : 'assistant',
    });

    if (!row.modelID) continue;
    let tokens;
    try {
      tokens = typeof row.tokens === 'string' ? JSON.parse(row.tokens) : row.tokens;
    } catch {
      continue;
    }
    const mapped = tokens && mapTokens(tokens);
    if (!mapped) continue;

    entries.push({
      source: 'opencode',
      model: row.modelID || 'unknown',
      ...(row.modelProvider ? { modelProvider: row.modelProvider } : {}),
      ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
      project,
      timestamp,
      ...mapped,
    });
  }
  return { entries, sessionEvents };
}

function parseFromJson(messagesDir) {
  const entries = [];
  const sessionEvents = [];
  if (!existsSync(messagesDir)) return { entries, sessionEvents };

  let sessionDirs;
  try {
    sessionDirs = readdirSync(messagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('ses_'));
  } catch {
    return { entries, sessionEvents };
  }

  for (const sessionDir of sessionDirs) {
    const sessionPath = join(messagesDir, sessionDir.name);
    let msgFiles;
    try {
      msgFiles = readdirSync(sessionPath).filter((file) => file.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of msgFiles) {
      let data;
      try {
        data = JSON.parse(readFileSync(join(sessionPath, file), 'utf-8'));
      } catch {
        continue;
      }

      const timestamp = new Date(data.time?.created);
      if (isNaN(timestamp.getTime())) continue;

      const project = projectFromRoot(data.path?.root);
      sessionEvents.push({
        sessionId: sessionDir.name,
        source: 'opencode',
        project,
        timestamp,
        role: data.role === 'user' ? 'user' : 'assistant',
      });

      if (!data.modelID) continue;
      const mapped = data.tokens && mapTokens(data.tokens);
      if (!mapped) continue;

      entries.push({
        source: 'opencode',
        model: data.modelID || 'unknown',
        ...(data.providerID ? { modelProvider: data.providerID } : {}),
        ...(data.variant ? { reasoningEffort: data.variant } : {}),
        project,
        timestamp,
        ...mapped,
      });
    }
  }
  return { entries, sessionEvents };
}

export async function parse({ sessionSalt } = {}) {
  const dataDir = resolveDataDir();
  if (!existsSync(dataDir)) return null;

  const dbPath = join(dataDir, 'opencode.db');
  if (existsSync(dbPath)) {
    try {
      const { entries, sessionEvents } = parseFromSqlite(dbPath);
      return {
        buckets: aggregateToBuckets(entries),
        sessions: extractSessions(sessionEvents, sessionSalt),
      };
    } catch {
      // DB unreadable (corrupt, locked, or no sqlite backend on this Node) —
      // fall through to the legacy JSON tree instead of failing the source.
    }
  }

  const { entries, sessionEvents } = parseFromJson(join(dataDir, 'storage', 'message'));
  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(sessionEvents, sessionSalt),
  };
}
