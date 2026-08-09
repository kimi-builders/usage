import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { delimiter, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';

/**
 * Claude Code parser (anthropics/claude-code).
 *
 * Claude Code stores one JSONL transcript per session under
 *   <root>/projects/<hyphen-joined-cwd>/<sessionId>.jsonl
 * (`transcripts/` is NOT scanned). Roots are resolved as follows:
 *
 * - KBU_USAGE_CLAUDE_DIRS set (even to an empty string): used exclusively,
 *   path.delimiter-separated. Empty means "no roots" (test hook / opt-out).
 * - Otherwise: $CLAUDE_CONFIG_DIR (`~` expanded) + ~/.claude + every
 *   ~/.claude-* directory in HOME that contains a projects/ subdir
 *   (multi-account setups keep parallel config homes).
 *
 * The same physical session file can appear under several roots (symlinked or
 * copied config homes); copies are deduped per session id keeping the "best"
 * copy. Individual usage records also carry a `uuid`, and copied session
 * files under DIFFERENT names would otherwise double-count, so entries are
 * deduped by uuid across all files of this source, keeping the payload with
 * the highest usage sum.
 */

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

// Dedup by realpath and keep only dirs that exist right now.
function dedupeExisting(candidates) {
  const seen = new Set();
  const roots = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    roots.push(candidate);
  }
  return roots;
}

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
function resolveRoots() {
  const override = process.env.KBU_USAGE_CLAUDE_DIRS;
  if (override !== undefined) {
    if (!override.trim()) return [];
    return dedupeExisting(
      override.split(delimiter).map((dir) => dir.trim()).filter(Boolean).map(expandHome),
    );
  }
  const candidates = [];
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) candidates.push(expandHome(configDir));
  const home = homedir();
  candidates.push(join(home, '.claude'));
  try {
    for (const entry of readdirSync(home, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('.claude-')) continue;
      const dir = join(home, entry.name);
      if (existsSync(join(dir, 'projects'))) candidates.push(dir);
    }
  } catch {
    // HOME unreadable — fall back to the default candidates only.
  }
  return dedupeExisting(candidates);
}

export function roots() {
  return resolveRoots();
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

// Collect <root>/projects/**/*.jsonl. Directory read failures are fatal for
// this source (the caller marks it failed and keeps its old state); a missing
// projects/ dir simply means no data.
function findSessionFiles(root) {
  const projectsDir = join(root, 'projects');
  if (!existsSync(projectsDir)) return [];
  const files = [];

  const walk = (dir, projectDirName) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name.endsWith('.jsonl')) {
        // Name check first: a directory named *.jsonl is still handed to
        // readFileSync, which fails loudly instead of silently skipping data.
        let stat;
        try {
          stat = statSync(path);
        } catch {
          continue; // vanished mid-scan
        }
        files.push({ path, projectDirName: projectDirName ?? entry.name, size: stat.size, mtimeMs: stat.mtimeMs });
      } else if (entry.isDirectory()) {
        walk(path, projectDirName ?? entry.name);
      }
    }
  };
  walk(projectsDir, null);
  return files;
}

// Best physical copy per session id: largest size, then newest mtime, then
// lexicographically smallest path (deterministic tie-break).
function pickBestCopy(files) {
  const byId = new Map();
  for (const file of files) {
    const sessionId = basename(file.path).slice(0, -'.jsonl'.length);
    const current = byId.get(sessionId);
    const better = !current
      || file.size > current.size
      || (file.size === current.size && file.mtimeMs > current.mtimeMs)
      || (file.size === current.size && file.mtimeMs === current.mtimeMs && file.path < current.path);
    if (better) byId.set(sessionId, { ...file, sessionId });
  }
  return Array.from(byId.values());
}

function projectFromDirName(dirName) {
  if (!dirName) return 'unknown';
  const segments = dirName.split('-').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : 'unknown';
}

function projectFromCwd(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  return basename(cwd.replace(/[/\\]+$/, '')) || null;
}

const SESSION_EVENT_TYPES = new Set(['user', 'assistant', 'tool_use', 'tool_result']);
const NO_REAL_MODEL = new Set(['', '<synthetic>']);

export async function parse({ sessionSalt } = {}) {
  const roots = resolveRoots();
  if (roots.length === 0) return null;

  const files = roots.flatMap((root) => findSessionFiles(root));
  const winners = pickBestCopy(files);

  const entries = [];
  const sessionEvents = [];

  for (const file of winners) {
    let content;
    try {
      // Bound the parsed content to the byte size captured at discovery time:
      // a line being appended right now is simply picked up by the next sync.
      content = readFileSync(file.path).subarray(0, file.size).toString('utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue; // vanished mid-scan
      throw error;
    }

    let project = null;
    let lastRealModel = null;

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }

      // Project = basename of the FIRST cwd in the file (file-level metadata,
      // captured even from records that are later skipped).
      if (!project) project = projectFromCwd(record.cwd);

      // Invalid/missing timestamp → skip the record entirely. Never stamp
      // "now": the parser is stateless, so a "now" fallback would re-key the
      // same record into a fresh 30-min bucket on every sync (duplicates).
      const ts = parseTimestamp(record?.timestamp);
      if (!ts) continue;

      const resolvedProject = project || projectFromDirName(file.projectDirName);

      if (SESSION_EVENT_TYPES.has(record.type)) {
        sessionEvents.push({
          sessionId: file.sessionId,
          source: 'claude-code',
          project: resolvedProject,
          timestamp: ts,
          role: record.type === 'user' ? 'user' : 'assistant',
        });
      }

      const usage = record.message?.usage;
      if (!usage || typeof usage !== 'object') continue;

      // Model: '<synthetic>'/'' records carry forward the last real model
      // seen in the same file.
      const rawModel = typeof record.message?.model === 'string' ? record.message.model.trim() : '';
      if (!NO_REAL_MODEL.has(rawModel)) lastRealModel = rawModel;
      const model = lastRealModel || 'unknown';

      // Cache writes: current logs carry BOTH the cache_creation total and
      // the 5m/1h breakdown — take the max, never the sum (they overlap).
      const ephemeral = tokenCount(usage.cache_creation?.ephemeral_5m_input_tokens)
        + tokenCount(usage.cache_creation?.ephemeral_1h_input_tokens);
      const inputTokens = tokenCount(usage.input_tokens);
      const cacheWriteInputTokens = Math.max(tokenCount(usage.cache_creation_input_tokens), ephemeral);
      const cacheReadInputTokens = tokenCount(usage.cache_read_input_tokens);
      const outputTokens = tokenCount(usage.output_tokens);
      if (!inputTokens && !cacheWriteInputTokens && !cacheReadInputTokens && !outputTokens) continue;

      entries.push({
        uuid: typeof record.uuid === 'string' && record.uuid ? record.uuid : null,
        source: 'claude-code',
        model,
        project: resolvedProject,
        timestamp: ts,
        inputTokens,
        cacheWriteInputTokens,
        cacheReadInputTokens,
        outputTokens,
        reasoningOutputTokens: 0,
        requestCount: 1,
      });
    }
  }

  // Entry-level uuid dedup across ALL files (copied sessions under different
  // names): keep the payload with the highest usage sum. Entries without a
  // uuid are always kept.
  const usageSum = (e) => e.inputTokens + e.cacheWriteInputTokens + e.cacheReadInputTokens
    + e.outputTokens + e.reasoningOutputTokens;
  const byUuid = new Map();
  const deduped = [];
  for (const entry of entries) {
    if (!entry.uuid) {
      deduped.push(entry);
      continue;
    }
    const current = byUuid.get(entry.uuid);
    if (!current || usageSum(entry) > usageSum(current)) {
      byUuid.set(entry.uuid, entry);
    }
  }
  for (const entry of byUuid.values()) deduped.push(entry);
  for (const entry of deduped) delete entry.uuid;

  return {
    buckets: aggregateToBuckets(deduped),
    sessions: extractSessions(sessionEvents, sessionSalt),
  };
}
