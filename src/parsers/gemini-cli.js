import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
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
 * INCLUDES cached and `output` INCLUDES thoughts — both are subtracted to
 * fit our mutually-exclusive contract. Legacy records that stored the raw
 * Gemini API usageMetadata shape are mapped the same way.
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

function findSessionFiles(baseDir) {
  const results = [];
  if (!existsSync(baseDir)) return results;

  let projectDirs;
  try {
    projectDirs = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return results;
  }

  const collect = (dir, depth) => {
    if (depth > 2) return; // chats/ + nested subagent dirs is as deep as it goes
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
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
function readRecords(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  if (filePath.endsWith('.jsonl')) {
    const messages = [];
    let directories = null;
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }
      // The metadata line carries directories; message lines carry a `type`.
      if (!directories && Array.isArray(obj.directories)) directories = obj.directories;
      if (typeof obj.type === 'string' || typeof obj.role === 'string') messages.push(obj);
    }
    return { messages, directories };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return {
    messages: data.messages || data.history || [],
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
// (cached out of input, thoughts out of output; negatives clamped).
function extractTokens(msg) {
  const t = msg.tokens;
  if (t) {
    const cached = tokenCount(t.cached);
    const thoughts = tokenCount(t.thoughts);
    const inputTokens = Math.max(0, tokenCount(t.input) - cached);
    const outputTokens = Math.max(0, tokenCount(t.output) - thoughts);
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
    const outputTokens = Math.max(0, tokenCount(u.candidatesTokenCount ?? u.output_tokens) - thoughts);
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
  return basename(String(first).replace(/[\\/]+$/, '')) || 'unknown';
}

export async function parse({ sessionSalt } = {}) {
  const tmpDir = resolveTmpDir();
  if (!existsSync(tmpDir)) return null;

  const entries = [];
  const sessionEvents = [];

  for (const filePath of findSessionFiles(tmpDir)) {
    const record = readRecords(filePath);
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
      const tokens = extractTokens(msg);
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
  };
}
