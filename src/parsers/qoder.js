import { createReadStream, existsSync, opendirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename, extname } from 'node:path';
import { aggregateToBuckets, extractSessions } from './index.js';
import { queryDbJsonSnapshotOnLock } from './sqlite.js';
import { QODER_EDITIONS, getQoderProjectsDir, getQoderDbPath, findQoderDataDirs } from '../qoder-roots.js';

function projectFromCwd(cwd) { return typeof cwd === 'string' ? cwd.trim().split(/[\\/]/).filter(Boolean).at(-1) || 'unknown' : 'unknown'; }
function toCount(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }

/**
 * Qoder (Alibaba's agentic coding platform). Two editions with fully separate
 * accounts, billing, model pools and data directories — see ../qoder-roots.js:
 *
 *   'qoder'     international qoder.com     ~/.qoder      Application Support/Qoder
 *   'qoder-cn'  China qoder.com.cn          ~/.qoder-cn   Application Support/QoderCN
 *
 * Each edition has two local data shapes, verified upstream on 2026-09-04 against
 * Qoder CLI 1.1.42, Qoder desktop app 0.1.6 and both IDEs 1.28.0:
 *
 * 1. The IDE's SQLite store <ideDataDir>/SharedClientCache/cache/db/local.db:
 *    table chat_message with `token_info` JSON { prompt_tokens, cached_tokens,
 *    completion_tokens, max_input_tokens } and `model_info` JSON { model_key }.
 *    Real tokens (prompt_tokens INCLUDES cached_tokens), no credits. `model_key`
 *    is usually a routing tier ('auto', 'ultimate', 'performance', 'efficient',
 *    'lite') rather than a concrete model; tiers are reported as `qoder-<tier>`
 *    so they stay unmatched server-side (see normalizeQoderModel).
 *    → token buckets + sessions.
 *
 * 2. JSONL transcripts (CLI + desktop app share them — the app embeds the CLI):
 *    <configDir>/projects/<cwd-slug>/<sessionId>.jsonl plus sub-agent files at
 *    <configDir>/projects/<cwd-slug>/<sessionId>/subagents/agent-*.jsonl.
 *    Claude Code-shaped records { type, timestamp, uuid, sessionId, cwd,
 *    message:{ id, role, model, content, usage } }. Qoder bills these in
 *    CREDITS: `message.usage` is { input_tokens:0, output_tokens:0, …,
 *    credits, original_credits, billable } — every token field is 0. One
 *    assistant message is written as several lines (one per content block);
 *    only the last line of a message carries `usage`.
 *    → sessions only. The credit amount is an account funding path and is not
 *    collected (cost-accounting invariant in AGENTS.md); token fields are read
 *    so that a future Qoder build that reports tokens is counted without a
 *    parser change.
 */

const DEFAULT_MODEL = 'qoder-agent';
const MAX_WARNINGS = 10;
export const QODER_SCAN_LIMITS = Object.freeze({
  maxDepth: 16, maxDirectories: 2048, maxEntries: 50_000,
  maxFiles: 10_000, maxBytes: 256 * 1024 * 1024,
});

// Qoder's routing tiers are not models. Left bare, `auto` collides with the
// Cursor `auto` entry in the server pricing map and gets billed at Cursor's
// rate, so tiers are namespaced (`qoder-auto`, …) — those never match a price
// and render as unmatched, which is the truthful state. Concrete model keys
// (`qmodel_38max`, …) are passed through unchanged.
const ROUTING_TIERS = new Set(['auto', 'ultimate', 'performance', 'efficient', 'lite']);

function normalizeQoderModel(key) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k) return DEFAULT_MODEL;
  return ROUTING_TIERS.has(k.toLowerCase()) ? `qoder-${k.toLowerCase()}` : k;
}

function toDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return toDate(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function warn(ctx, message) {
  if (ctx.warnings.length < MAX_WARNINGS) ctx.warnings.push(`${ctx.source}: ${message}`);
}

// ── JSONL layer (CLI + desktop app) ────────────────────────────────────────

function* listJsonlFiles(root, ctx) {
  const { budget, limits } = ctx;
  function* walk(dir, depth) {
    if (depth > limits.maxDepth) {
      ctx.skipped = true;
      warn(ctx, 'directory depth budget exceeded; choose a narrower projects directory');
      return;
    }
    if (++budget.directories > limits.maxDirectories) {
      budget.exhausted = true;
      ctx.skipped = true;
      warn(ctx, 'directory count budget exceeded; choose a narrower projects directory');
      return;
    }
    let directory;
    try {
      directory = opendirSync(dir);
      let entry;
      while (!budget.exhausted && (entry = directory.readSync())) {
        if (++budget.entries > limits.maxEntries) {
          budget.exhausted = true;
          ctx.skipped = true;
          warn(ctx, 'directory entry budget exceeded; choose a narrower projects directory');
          break;
        }
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(path, depth + 1);
        else if (entry.isFile() && extname(entry.name) === '.jsonl') {
          if (++budget.files > limits.maxFiles) {
            budget.exhausted = true;
            ctx.skipped = true;
            warn(ctx, 'transcript file budget exceeded; choose a narrower projects directory');
            break;
          }
          yield path;
        }
      }
    } catch (err) {
      ctx.skipped = true;
      warn(ctx, `cannot read ${dir}: ${err.message}`);
    } finally {
      directory?.closeSync();
    }
  }
  yield* walk(root, 0);
}

function transcriptUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const counts = {
    inputTokens: toCount(usage.input_tokens),
    cacheWriteInputTokens: toCount(usage.cache_creation_input_tokens),
    cacheReadInputTokens: toCount(usage.cache_read_input_tokens ?? usage.cached_tokens),
    outputTokens: toCount(usage.output_tokens), reasoningOutputTokens: 0,
  };
  return Object.values(counts).some(Boolean) ? counts : null;
}

function mergeTranscriptRecord(ctx, key, record) {
  const previous = ctx.transcripts.get(key);
  if (!previous) { ctx.transcripts.set(key, record); return; }
  // Select one whole observed record, never sum copied messages or manufacture
  // a per-field maximum. Missing usage in a streamed content block cannot erase
  // the complete usage from another copy. Ties are independent of directory order.
  if (previous.usage && record.usage && JSON.stringify(previous.usage) !== JSON.stringify(record.usage)) {
    ctx.skipped = true;
    warn(ctx, 'conflicting copied message usage; retained one complete observation');
  }
  const rank = (item) => [
    Object.values(item.usage || {}).reduce((sum, value) => sum + value, 0),
    item.timestamp.getTime(), JSON.stringify([item.project, item.model, item.usage]),
  ];
  const left = rank(previous); const right = rank(record);
  for (let i = 0; i < left.length; i++) {
    if (left[i] === right[i]) continue;
    if (right[i] > left[i]) ctx.transcripts.set(key, record);
    break;
  }
}

// A `user` record is a human prompt unless it is a tool result being fed back.
function isHumanPrompt(record) {
  if (record.humanInput) return true;
  if (record.origin && record.origin.kind === 'human') return true;
  if (record.toolUseResult) return false;
  const content = record.message?.content;
  if (Array.isArray(content)) {
    return !content.some(c => c && typeof c === 'object' && c.type === 'tool_result');
  }
  return true;
}

async function parseTranscriptFile(filePath, ctx) {
  const snapshot = statSync(filePath);
  if (!snapshot.isFile() || snapshot.size > 64 * 1024 * 1024) throw new Error('Transcript exceeds the 64 MiB snapshot limit or is not a file');
  if (ctx.budget.bytes + snapshot.size > ctx.limits.maxBytes) {
    ctx.budget.exhausted = true;
    throw new Error('Transcript byte budget exceeded; choose a narrower projects directory');
  }
  ctx.budget.bytes += snapshot.size;
  if (!snapshot.size) return;
  const fallbackSession = basename(filePath, '.jsonl');
  // One assistant message spans several lines; keep the last usage-bearing
  // record per message id so a call is counted exactly once.
  const records = new Map();
  let lineNumber = 0;

  const input = createReadStream(filePath, { encoding: 'utf-8', end: snapshot.size - 1 });
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      lineNumber++;
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        ctx.skipped = true;
        warn(ctx, 'malformed or incomplete transcript record; retaining previous source state');
        continue;
      }
      if (!record || typeof record !== 'object') continue;
      const type = record.type;
      if (type !== 'user' && type !== 'assistant') continue;

      const timestamp = toDate(record.timestamp);
      if (!timestamp) continue;
      const sessionId = record.sessionId || record.session_id || fallbackSession;
      const project = projectFromCwd(record.cwd);
      const message = record.message && typeof record.message === 'object' ? record.message : {};
      const id = message.id || record.uuid;
      const key = JSON.stringify([sessionId, type, id || `${filePath}:${lineNumber}`]);
      if (type === 'user') {
        if (isHumanPrompt(record)) {
          records.set(key, { sessionId, project, timestamp, role: 'user', usage: null });
        }
        continue;
      }
      records.set(key, {
        sessionId, role: 'assistant',
        usage: transcriptUsage(message.usage) || records.get(key)?.usage || null,
        model: normalizeQoderModel(message.model),
        project,
        timestamp,
      });
    }

  } finally {
    rl.close();
    input.destroy();
  }
  if (statSync(filePath).size < snapshot.size) throw new Error('Transcript was truncated during the scan');
  for (const [key, record] of records) mergeTranscriptRecord(ctx, key, record);
}

async function parseTranscripts(edition, ctx) {
  const root = getQoderProjectsDir(edition);
  if (!existsSync(root)) return;
  for (const file of listJsonlFiles(root, ctx)) {
    try {
      await parseTranscriptFile(file, ctx);
    } catch (err) {
      // A half-written or unreadable transcript: keep prior upload state, retry next run.
      ctx.skipped = true;
      warn(ctx, `cannot read ${file}: ${err.message}`);
    }
  }
  for (const { sessionId, role, usage, model, project, timestamp } of ctx.transcripts.values()) {
    ctx.events.push({ sessionId, source: ctx.source, project, timestamp, role });
    if (usage) ctx.entries.push({ source: ctx.source, model, project, timestamp, ...usage });
  }
}

// ── SQLite layer (IDE) ─────────────────────────────────────────────────────

const IDE_COLUMNS = `
  cm.id AS id,
  cm.session_id AS sessionId,
  cm.request_id AS requestId,
  cm.role AS role,
  cm.token_info AS tokenInfo,
  cm.model_info AS modelInfo,
  cm.gmt_create AS created`;

// Only token/model/timing columns are selected; message content, tool results
// and summaries are never read.
const IDE_QUERY_WITH_SESSION = `SELECT ${IDE_COLUMNS},
  cs.project_uri AS projectUri,
  cs.project_name AS projectName,
  cs.preferred_model_info AS preferredModelInfo
  FROM chat_message cm
  LEFT JOIN chat_session cs ON cs.session_id = cm.session_id
  WHERE cm.role IN ('user', 'assistant')`;

const IDE_QUERY_PLAIN = `SELECT ${IDE_COLUMNS}
  FROM chat_message cm
  WHERE cm.role IN ('user', 'assistant')`;

function isMissingTable(err, table) {
  return err && typeof err.message === 'string' && new RegExp(`no such table:\\s*${table}`, 'i').test(err.message);
}

function queryIdeRows(dbPath) {
  const opts = { tempPrefix: 'kbu-qoder-' };
  try {
    return queryDbJsonSnapshotOnLock(dbPath, IDE_QUERY_WITH_SESSION, opts);
  } catch (err) {
    // Older Qoder CN builds have no chat_session table; degrade to unattributed projects.
    if (isMissingTable(err, 'chat_session')) return queryDbJsonSnapshotOnLock(dbPath, IDE_QUERY_PLAIN, opts);
    // A missing usage table is schema drift, not a successful empty scan.
    throw err;
  }
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function ideProject(row) {
  const uri = typeof row.projectUri === 'string' ? row.projectUri.trim() : '';
  if (uri) {
    if (uri.startsWith('file://')) {
      try {
        return projectFromCwd(decodeURIComponent(new URL(uri).pathname));
      } catch {
        // fall through to project_name
      }
    } else {
      return projectFromCwd(uri);
    }
  }
  const name = typeof row.projectName === 'string' ? row.projectName.trim() : '';
  // '.' is Qoder's "no project" sentinel.
  return name && name !== '.' ? projectFromCwd(name) : 'unknown';
}

function ideModel(row) {
  const info = parseJson(row.modelInfo);
  const preferred = parseJson(row.preferredModelInfo);
  const key = info?.model_key || info?.modelKey || preferred?.model_key || preferred?.modelKey;
  return normalizeQoderModel(key);
}

function parseIde(edition, ctx) {
  const { source, entries, events } = ctx;
  const dbPath = getQoderDbPath(edition);
  if (!existsSync(dbPath)) return;

  let rows;
  try {
    rows = queryIdeRows(dbPath);
  } catch (err) {
    // Schema drift or a transient read failure: fail soft so incremental state
    // for this source is not pruned.
    ctx.skipped = true;
    warn(ctx, `cannot read ${dbPath}: ${err.message}`);
    return;
  }

  for (const row of rows) {
    const timestamp = toDate(row.created);
    if (!timestamp) continue;
    const project = ideProject(row);
    const sessionId = row.sessionId || 'unknown';
    const role = row.role === 'user' ? 'user' : 'assistant';
    events.push({ sessionId, source, project, timestamp, role });
    if (role !== 'assistant') continue;

    const tokens = parseJson(row.tokenInfo);
    if (!tokens) continue;
    const prompt = toCount(tokens.prompt_tokens);
    const cached = Math.min(prompt, toCount(tokens.cached_tokens));
    const completion = toCount(tokens.completion_tokens);
    if (prompt + completion === 0) continue;

    entries.push({
      source,
      model: ideModel(row),
      project,
      timestamp,
      // prompt_tokens already includes cached_tokens.
      inputTokens: prompt - cached,
      outputTokens: completion,
      cacheReadInputTokens: cached,
      reasoningOutputTokens: 0,
    });
  }
}

// ── Entry points ───────────────────────────────────────────────────────────

async function parseEdition(edition, { sessionSalt, scanLimits = {} } = {}) {
  if (!findQoderDataDirs(edition).length) return null;
  // Test callers may lower budgets, but no caller can silently remove a cap.
  const limits = Object.fromEntries(Object.entries(QODER_SCAN_LIMITS).map(([key, maximum]) => [
    key, Number.isSafeInteger(scanLimits[key]) && scanLimits[key] >= 0 ? Math.min(scanLimits[key], maximum) : maximum,
  ]));
  const ctx = {
    source: QODER_EDITIONS[edition].source, entries: [], events: [], warnings: [], skipped: false,
    transcripts: new Map(), limits,
    budget: { directories: 0, entries: 0, files: 0, bytes: 0, exhausted: false },
  };
  await parseTranscripts(edition, ctx);
  parseIde(edition, ctx);
  return {
    buckets: aggregateToBuckets(ctx.entries),
    sessions: extractSessions(ctx.events, sessionSalt),
    skipped: ctx.skipped,
    warnings: ctx.warnings,
  };
}

export async function parseQoder(options) {
  return parseEdition('qoder', options);
}

export async function parseQoderCn(options) {
  return parseEdition('qoder-cn', options);
}
