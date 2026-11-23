import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { aggregateToBuckets, extractSessions } from './index.js';
import { queryDbJson } from './sqlite.js';
import { openCodeDataRoots } from '../opencode-roots.js';
import { openAiRequestContextTier } from '../model-meta.js';

/**
 * OpenCode parser (sst/opencode).
 *
 * Data dir: KBU_USAGE_OPENCODE_DIR (test hook / custom installs), else
 * $XDG_DATA_HOME/opencode, else ~/.local/share/opencode, plus the native
 * %LOCALAPPDATA%/opencode store on Windows. Stores seen in the
 * wild:
 *
 * 1. SQLite, 1.x layout (opencode >= v0.2): <dir>/opencode.db — a SQLite
 *    database whose `message` table keeps one JSON document per message.
 *    Usage lives at data.tokens {input, output, reasoning, cache:{read,
 *    write}}; `input` is already the uncached input count, so the fields map
 *    straight onto our mutually-exclusive contract (cache.write →
 *    cacheWriteInputTokens).
 * 2. SQLite, 2.x layout: the same accounting moved into the event-sourced
 *    `session_message` projection (the row's `type` is the role, model and
 *    tokens live inside `data`), and the session table was renamed
 *    `session` → `session_v2`. Message data carries no `path`, so the
 *    project comes from the session row's `directory`. Reading only
 *    `message` here used to die with "no such table: message" and silently
 *    zero the whole source.
 * 3. Legacy: <dir>/storage/message/ses_*&#47;*.json — one JSON object per
 *    message with the same shape.
 *
 * The SQLite path is tried first; if the DB is unreadable — including the
 * case where neither node:sqlite nor the sqlite3 CLI exists — the parser
 * falls back to the legacy JSON tree instead of failing the source. A DB
 * that parsed is never combined with the JSON tree, so the two cannot
 * double-count. Any failed DB read is partial, never a healthy empty scan.
 * When only one layout fails, retain the readable layout; when neither can
 * be read, attach the warning to whatever the JSON fallback still yields.
 */

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
export function roots({ environment, home, platform } = {}) {
  return openCodeDataRoots(environment, home, platform).filter(existsSync);
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

// 1.x layout: one JSON document per row in `message`.
const V1_MESSAGE_SQL = `SELECT
  id,
  session_id as sessionID,
  json_extract(data, '$.role') as role,
  json_extract(data, '$.time.created') as created,
  coalesce(json_extract(data, '$.modelID'), json_extract(data, '$.model.modelID'), json_extract(data, '$.model.id')) as modelID,
  coalesce(json_extract(data, '$.providerID'), json_extract(data, '$.model.providerID')) as modelProvider,
  json_extract(data, '$.variant') as reasoningEffort,
  json_extract(data, '$.tokens') as tokens,
  json_extract(data, '$.path.root') as rootPath
  FROM message ORDER BY id`;

// 2.x layout: the session_message projection. `m.type` is the role, `data`
// holds the same model/tokens accounting (model under `model.id` in 2.x,
// `modelID` in older rows). Only column/JSON accounting fields are selected —
// never message text, tool payloads, or costs. Message data carries no
// `path`, so the project directory is joined from the session row; both
// session-table names exist in the wild (2.x renamed session → session_v2).
function sessionMessageSql(sessionTable) {
  const sessionJoin = sessionTable
    ? `,\n    s.directory as directory
    FROM session_message m
    LEFT JOIN ${sessionTable} s ON s.id = m.session_id`
    : `
    FROM session_message m`;
  return `SELECT
    m.id as id,
    m.session_id as sessionID,
    m.type as role,
    coalesce(json_extract(m.data, '$.time.created'), m.time_created) as created,
    coalesce(json_extract(m.data, '$.model.id'), json_extract(m.data, '$.modelID'), json_extract(m.data, '$.model.modelID')) as modelID,
    coalesce(json_extract(m.data, '$.model.providerID'), json_extract(m.data, '$.providerID'), json_extract(m.data, '$.model.provider')) as modelProvider,
    json_extract(m.data, '$.variant') as reasoningEffort,
    json_extract(m.data, '$.tokens') as tokens${sessionJoin}
    WHERE m.type IN ('user', 'assistant')
    ORDER BY m.id`;
}

// Rough completeness of a row's token counters, used only to pick the most
// complete copy of one duplicated message. Unparseable counters sort lowest so
// a readable copy always wins; the entry loop still skips them.
function tokenSize(row) {
  // A broken mirror must not displace a usable copy just because its counters
  // are larger. Match the timestamp/model gates used by parseRows below.
  if (!Number.isFinite(new Date(row.created).getTime()) || !row.modelID) return -1;
  let tokens = row.tokens;
  if (typeof tokens === 'string') {
    try {
      tokens = JSON.parse(tokens);
    } catch {
      return -1;
    }
  }
  if (!tokens || typeof tokens !== 'object') return -1;
  return (Number(tokens.input) || 0) + (Number(tokens.output) || 0)
    + (Number(tokens.reasoning) || 0)
    + (Number(tokens.cache?.read) || 0) + (Number(tokens.cache?.write) || 0);
}

function readSqliteRows(dbPath) {
  const tables = new Set(queryDbJson(dbPath,
    `SELECT name FROM sqlite_master WHERE type = 'table'
     AND name IN ('message', 'session_message', 'session', 'session_v2')`)
    .map((row) => row.name));
  if (!tables.has('message') && !tables.has('session_message')) {
    throw new Error(
      `unrecognized table layout (no message / session_message table): ${dbPath}`,
    );
  }

  // A migrated store can keep both layouts for the same history. Legacy rows
  // are read first so an equal copy never displaces them: projects that
  // earlier uploads already used keep their names. Message ids are unique
  // within a session, so the same message mirrored into both layouts is
  // counted once (most complete token copy wins). Rows without an id cannot
  // prove identity and are never merged.
  const merged = new Map();
  const warnings = [];
  let readableTables = 0;
  let anonymousId = 0;
  const sessionTable = tables.has('session_v2') ? 'session_v2'
    : (tables.has('session') ? 'session' : null);
  for (const [table, sql] of [
    ['message', V1_MESSAGE_SQL], ['session_message', sessionMessageSql(sessionTable)],
  ]) {
    if (!tables.has(table)) continue;
    try {
      // Never pass database-sized arrays as function arguments: large stores
      // exceed V8's argument limit. Merge each readable layout independently.
      for (const row of queryDbJson(dbPath, sql)) {
        const key = row.id == null || row.id === ''
          ? `#${anonymousId++}`
          : JSON.stringify([row.sessionID || 'unknown', row.id]);
        const previous = merged.get(key);
        if (!previous || tokenSize(row) > tokenSize(previous)) merged.set(key, row);
      }
      readableTables += 1;
    } catch (error) {
      warnings.push(`opencode: could not read ${table}: ${error.message}`);
    }
  }
  if (!readableTables) throw new Error(warnings.join('; '));
  return { rows: merged.values(), warnings };
}

function parseRows(rows) {
  const entries = [];
  const sessionEvents = [];
  for (const row of rows) {
    // time.created is integer milliseconds. Invalid → skip the row entirely;
    // never stamp "now" (a stateless parser would re-key it on every sync).
    const timestamp = new Date(row.created);
    if (isNaN(timestamp.getTime())) continue;

    // 1.x rows carry the project in the message's path.root; 2.x message data
    // has no path, so the project falls back to the session row's directory.
    // Those rows come from a store this parser could not read before, so the
    // fallback cannot rename any previously uploaded project.
    const project = row.rootPath ? projectFromRoot(row.rootPath) : projectFromRoot(row.directory);
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
    const contextTier = openAiRequestContextTier(row.modelID,
      mapped.inputTokens + mapped.cacheReadInputTokens + mapped.cacheWriteInputTokens);

    entries.push({
      source: 'opencode',
      model: row.modelID || 'unknown',
      ...(contextTier ? { contextTier } : {}),
      ...(row.modelProvider ? { modelProvider: row.modelProvider } : {}),
      ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
      project,
      timestamp,
      ...mapped,
    });
  }
  return { entries, sessionEvents };
}

function readJsonRows(messagesDir) {
  const rows = [];
  if (!existsSync(messagesDir)) return rows;

  let sessionDirs;
  try {
    sessionDirs = readdirSync(messagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('ses_'));
  } catch {
    return rows;
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

      rows.push({
        id: data.id || basename(file, '.json'), sessionID: data.sessionID || sessionDir.name,
        created: data.time?.created, role: data.role, modelID: data.modelID || data.model?.modelID || data.model?.id,
        modelProvider: data.providerID || data.model?.providerID, reasoningEffort: data.variant,
        rootPath: data.path?.root, tokens: data.tokens,
      });
    }
  }
  return rows;
}

export async function parse({ sessionSalt, environment, home, platform } = {}) {
  const directories = roots({ environment, home, platform });
  if (!directories.length) return null;
  const merged = new Map();
  const warnings = [];
  let anonymousId = 0;
  for (const dataDir of directories) {
    const dbPath = join(dataDir, 'opencode.db');
    let rows;
    if (existsSync(dbPath)) {
      try {
        const result = readSqliteRows(dbPath);
        rows = result.rows;
        for (const warning of result.warnings) warnings.push(warning);
      } catch (error) {
        warnings.push(`opencode: incomplete SQLite scan: ${error.message}`);
      }
    }
    // Keep the existing SQLite-over-JSON rule within each store. Across stores,
    // merge by session + message identity, choosing the most complete copy.
    rows ??= readJsonRows(join(dataDir, 'storage', 'message'));
    for (const row of rows) {
      const key = row.id && row.sessionID ? JSON.stringify([row.sessionID, row.id]) : `#${anonymousId++}`;
      const previous = merged.get(key);
      if (!previous || tokenSize(row) > tokenSize(previous)) merged.set(key, row);
    }
  }
  const { entries, sessionEvents } = parseRows(merged.values());
  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(sessionEvents, sessionSalt),
    ...(warnings.length ? { skipped: true, warnings } : {}),
  };
}
