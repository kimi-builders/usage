import { jsonlRecords } from './jsonl-records.js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';

/**
 * Gemini CLI parser (google-gemini/gemini-cli).
 *
 * Session storage under ~/.gemini/tmp (KBU_USAGE_GEMINI_DIR overrides):
 *   <tmp>/<project_hash>/chats/session-<ts>-<id>.jsonl   (current, v0.39+)
 *   <tmp>/<project_hash>/chats/session-<ts>-<id>.json    (legacy, one JSON object)
 *   <tmp>/<project_hash>/chats/<parent_id>/<sub_id>.jsonl (subagent sessions)
 * Both extensions are collected, descending into subagent subdirectories.
 *
 * .jsonl layout: line 1 is session metadata (carries `directories`, used for
 * the project name); each following line is one record. Model turns are
 * type 'gemini' (older files used role 'model'/'assistant'); user turns are
 * 'user'; info/error/warning records are system noise and skipped.
 *
 * Tokens live in msg.tokens.{input,output,cached,thoughts} where `input`
 * INCLUDES cached. `output` (candidatesTokenCount) and `thoughts` are separate
 * counters. Only cached input is subtracted for the exclusive contract.
 */

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
function resolveTmpDir() {
  const override = process.env.KBU_USAGE_GEMINI_DIR?.trim();
  if (override) return override;
  return join(homedir(), '.gemini', 'tmp');
}

export function roots() {
  const dir = resolveTmpDir();
  return existsSync(dir) ? [dir] : [];
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function findSessionFiles(baseDir, warn) {
  const results = [];
  if (!existsSync(baseDir)) return results;

  let projectDirs;
  try {
    projectDirs = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    warn('cannot read a project directory; healthy records retained');
    return results;
  }

  const collect = (dir, depth) => {
    if (depth > 2) return; // chats/ + nested subagent dirs is as deep as it goes
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') warn('cannot read a session directory; healthy records retained');
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full, depth + 1);
      else if (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json')) results.push(full);
    }
  };

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    collect(join(baseDir, entry.name, 'chats'), 0);
  }
  return results;
}

// Read a session file into a uniform { messages, directories } shape.
async function readRecords(filePath, warn) {
  if (filePath.endsWith('.jsonl')) {
    const messages = [];
    let directories = null;
    for await (const obj of jsonlRecords(filePath, warn)) {
      if (!directories && Array.isArray(obj.directories)) directories = obj.directories;
      if (typeof obj.type === 'string' || typeof obj.role === 'string') messages.push({ type: obj.type, role: obj.role, timestamp: obj.timestamp, createTime: obj.createTime, model: obj.model, tokens: extractTokens(obj) });
    }
    return { messages, directories };
  }

  let data;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.messages || data.history || [])) throw new Error();
  } catch {
    warn('invalid or unreadable JSON session; healthy files retained');
    return null;
  }
  return {
    messages: (data.messages || data.history || []).flatMap((msg) => {
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { warn('invalid message type; healthy records retained'); return []; }
      return [{ type: msg.type, role: msg.role, timestamp: msg.timestamp, createTime: msg.createTime, model: msg.model, tokens: extractTokens(msg) }];
    }),
    directories: Array.isArray(data.directories) ? data.directories : null,
  };
}

function classifyRole(msg) {
  const type = msg.type ?? msg.role;
  if (type === 'user') return 'user';
  if (type === 'gemini' || type === 'model' || type === 'assistant') return 'assistant';
  return null;
}

// msg.tokens / usageMetadata → our mutually-exclusive 5-field contract
// (cached out of input; candidate output excludes thoughts already).
function extractTokens(msg) {
  const t = msg.tokens;
  if (t) {
    const cached = tokenCount(t.cached);
    const thoughts = tokenCount(t.thoughts);
    const inputTokens = Math.max(0, tokenCount(t.input) - cached);
    const outputTokens = tokenCount(t.output);
    if (!inputTokens && !cached && !outputTokens && !thoughts) return null;
    return {
      inputTokens,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: cached,
      outputTokens,
      reasoningOutputTokens: thoughts,
    };
  }
  const u = msg.usageMetadata || msg.usage;
  if (u) {
    const cached = tokenCount(u.cachedContentTokenCount);
    const thoughts = tokenCount(u.thoughtsTokenCount);
    const inputTokens = Math.max(0, tokenCount(u.promptTokenCount ?? u.input_tokens) - cached);
    const outputTokens = tokenCount(u.candidatesTokenCount ?? u.output_tokens);
    if (!inputTokens && !cached && !outputTokens && !thoughts) return null;
    return {
      inputTokens,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: cached,
      outputTokens,
      reasoningOutputTokens: thoughts,
    };
  }
  return null;
}

function projectFromDirectories(directories) {
  const first = Array.isArray(directories) ? directories[0] : null;
  if (!first) return 'unknown';
  return String(first).split(/[\\/]/).filter(Boolean).at(-1) || 'unknown';
}

export async function parse({ sessionSalt } = {}) {
  const tmpDir = resolveTmpDir();
  if (!existsSync(tmpDir)) return null;

  const warnings = [];
  const warn = (message) => { if (warnings.length < 20) warnings.push(`gemini-cli: ${message}`); };
  const entries = [];
  const sessionEvents = [];

  for (const filePath of findSessionFiles(tmpDir, warn)) {
    const record = await readRecords(filePath, warn);
    if (!record) continue;

    const project = projectFromDirectories(record.directories);

    for (const msg of record.messages) {
      const role = classifyRole(msg);
      if (!role) continue;

      // Invalid/missing timestamp → skip the record entirely; never stamp
      // "now" (a stateless parser would re-key it on every sync).
      const stamp = msg.timestamp || msg.createTime;
      if (!stamp) continue;
      const ts = new Date(stamp);
      if (isNaN(ts.getTime())) continue;

      sessionEvents.push({ sessionId: filePath, source: 'gemini-cli', project, timestamp: ts, role });

      if (role !== 'assistant') continue;
      const tokens = msg.tokens;
      if (!tokens) continue;

      entries.push({
        source: 'gemini-cli',
        model: msg.model || 'unknown',
        project,
        timestamp: ts,
        ...tokens,
      });
    }
  }

  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(sessionEvents, sessionSalt),
    ...(warnings.length ? { skipped: true, warnings } : {}),
  };
}
