import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { aggregateToBuckets, extractSessions } from './index.js';

/**
 * Codex CLI parser (openai/codex).
 *
 * Rollout files live under <home>/sessions/ and <home>/archived_sessions/
 * (recursively, *.jsonl; home = KBU_USAGE_CODEX_HOME, else
 * $CODEX_HOME, else ~/.codex). The same session can exist in both trees
 * (live + archive overlap), so physical copies are deduped per session id
 * keeping the file with the most parseable records.
 *
 * Token accounting prefers `info.last_token_usage` (a per-request delta).
 * When it is absent we fall back to the cumulative `total_token_usage` minus
 * a running baseline; a negative field in that delta means the counter was
 * reset (compaction / new window), so the current total becomes the delta.
 * A repeated positive total_tokens is bookkeeping noise (e.g. compaction
 * re-emission) and the event is skipped entirely.
 *
 * Forked / sub-agent sessions replay the parent's token_count history into
 * their own rollout with fresh outer timestamps. Replayed prefixes are
 * detected by fingerprinting the payload content ({model, total_token_usage,
 * last_token_usage} with recursively sorted keys) and skipping the longest
 * child prefix that matches a suffix of the parent's pre-fork sequence.
 */

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
function resolveHome() {
  const override = process.env.KBU_USAGE_CODEX_HOME?.trim();
  if (override) return override;
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) return expandHome(codexHome);
  return join(homedir(), '.codex');
}

export function roots() {
  const home = resolveHome();
  return existsSync(home) ? [home] : [];
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function parseTimestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

// Recursively key-sorted JSON: the fingerprint must survive replay
// re-serialization, where key order is not guaranteed to survive.
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function tokenFingerprint(model, info) {
  return createHash('sha256').update(stableJson({
    model: model ?? null,
    total_token_usage: info?.total_token_usage ?? null,
    last_token_usage: info?.last_token_usage ?? null,
  })).digest('hex').slice(0, 16);
}

// Collect *.jsonl under both rollout trees. Directory read failures are
// fatal for this source (the caller marks it failed and keeps its old
// state); a missing tree simply means no data.
function findRolloutFiles(home) {
  const files = [];
  for (const tree of ['sessions', 'archived_sessions']) {
    const base = join(home, tree);
    if (!existsSync(base)) continue;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.name.endsWith('.jsonl')) {
          // Name check first: a directory named *.jsonl is still handed to
          // the stream reader, which fails loudly instead of silently skipping data.
          let stat;
          try {
            stat = statSync(path);
          } catch {
            continue; // vanished mid-scan
          }
          if (!stat.isFile()) {
            throw Object.assign(new Error(`Codex rollout is not a regular file: ${path}`), {
              code: 'EISDIR',
            });
          }
          files.push({ path, size: stat.size });
        } else if (entry.isDirectory()) {
          walk(path);
        }
      }
    };
    walk(base);
  }
  files.sort((left, right) => (left.path < right.path ? -1 : 1));
  return files;
}

// Stream one rollout instead of materializing the whole JSONL as a single
// string. Real Codex sessions can grow beyond V8's ~512 MB string limit. Keep
// full payloads only for the three record types used by token/model/session
// identity logic; ordinary message/tool records retain timestamp + type only.
// `recordCount` preserves physical-copy winner selection exactly.
async function readRollout(file) {
  const records = [];
  let meta = null;
  let recordCount = 0;
  if (file.size > 0) {
    const input = createReadStream(file.path, {
      encoding: 'utf8',
      end: file.size - 1,
      highWaterMark: 256 * 1024,
    });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line) continue;
        let raw;
        try { raw = JSON.parse(line); } catch { continue; }
        recordCount += 1;
        if (raw?.type === 'session_meta') {
          if (!meta) {
            meta = raw;
            records.push(raw);
          }
          continue;
        }
        if (raw?.type === 'turn_context' || isTokenCount(raw)) {
          records.push(raw);
          continue;
        }
        if (parseTimestampMs(raw?.timestamp) !== null) {
          records.push({ timestamp: raw.timestamp, type: raw.type });
        }
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    } finally {
      lines.close();
      input.destroy();
    }
  }
  // Only the FIRST session_meta is canonical — later ones are copied parent
  // history. Without any meta, the session id falls back to the filename.
  const metaId = meta?.payload?.id;
  const sessionId = (typeof metaId === 'string' && metaId) || basename(file.path).slice(0, -'.jsonl'.length);
  return { file, records, recordCount, meta, sessionId };
}

function isTokenCount(record) {
  return record?.type === 'event_msg' && record?.payload?.type === 'token_count';
}

function isChildSession(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return Boolean(
    payload.forked_from_id
    || payload.parent_thread_id
    || payload.thread_source === 'subagent'
    || payload.source === 'subagent'
    || (payload.source && typeof payload.source === 'object' && 'subagent' in payload.source),
  );
}

function parentIdOf(payload) {
  return payload.forked_from_id
    || payload.parent_thread_id
    || payload.source?.subagent?.thread_spawn?.parent_thread_id
    || null;
}

function projectFrom(payload) {
  const cwd = payload?.cwd;
  if (typeof cwd === 'string' && cwd) {
    const name = basename(cwd.replace(/[/\\]+$/, ''));
    if (name) return name;
  }
  const url = payload?.git?.repository_url;
  if (typeof url === 'string' && url) {
    const last = url.split('/').filter(Boolean).pop() || '';
    const name = last.replace(/\.git$/, '');
    if (name) return name;
  }
  return 'unknown';
}

export async function parse({ sessionSalt } = {}) {
  const home = resolveHome();
  if (!existsSync(home)) return null;

  // Physical copy dedup: same session id in several files (live + archive
  // overlap) → keep the file with the most parseable records, parse losers
  // not at all. Ties go to the lexicographically smallest path.
  const rollouts = [];
  for (const file of findRolloutFiles(home)) {
    const rollout = await readRollout(file);
    if (rollout) rollouts.push(rollout);
  }
  const winners = new Map();
  for (const rollout of rollouts) {
    const current = winners.get(rollout.sessionId);
    if (!current
      || rollout.recordCount > current.recordCount
      || (rollout.recordCount === current.recordCount && rollout.file.path < current.file.path)) {
      winners.set(rollout.sessionId, rollout);
    }
  }
  const sessions = Array.from(winners.values());

  // Per-session token_count fingerprint sequences (record order) — needed
  // both for the parent's replay snapshot and the child's prefix skip.
  const fingerprints = new Map();
  for (const session of sessions) {
    const sequence = [];
    for (const record of session.records) {
      if (!isTokenCount(record)) continue;
      const info = record.payload?.info;
      sequence.push({
        record,
        fingerprint: tokenFingerprint(info?.model ?? record.payload?.model, info),
        timestampMs: parseTimestampMs(record.timestamp),
      });
    }
    fingerprints.set(session.sessionId, sequence);
  }

  const entries = [];
  const sessionEvents = [];

  for (const session of sessions) {
    const payload = session.meta?.payload;
    const project = projectFrom(payload);
    const agentVersion = typeof payload?.cli_version === 'string' ? payload.cli_version.trim() : '';
    const modelProvider = typeof payload?.model_provider === 'string' ? payload.model_provider.trim() : '';

    // Fork cutoff: the child replays parent history up to its own start.
    const startedAtMs = payload
      ? parseTimestampMs(payload.timestamp) ?? parseTimestampMs(session.meta?.timestamp)
      : null;

    // Replay skip: longest child prefix matching a suffix of the parent's
    // pre-fork fingerprint sequence. Parent missing from this scan → fail
    // open (count everything).
    let skipPrefix = 0;
    if (payload && isChildSession(payload)) {
      const parentSequence = fingerprints.get(parentIdOf(payload));
      if (parentSequence) {
        const snapshot = parentSequence
          .filter((event) => event.timestampMs !== null && startedAtMs !== null && event.timestampMs <= startedAtMs)
          .map((event) => event.fingerprint);
        const childSequence = fingerprints.get(session.sessionId).map((event) => event.fingerprint);
        const maxK = Math.min(snapshot.length, childSequence.length);
        for (let k = maxK; k >= 1; k -= 1) {
          let matches = true;
          for (let i = 0; i < k; i += 1) {
            if (childSequence[i] !== snapshot[snapshot.length - k + i]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            skipPrefix = k;
            break;
          }
        }
      }
    }

    const firstMeta = session.meta;
    let stickyModel = null;
    let stickyEffort = null;
    let baseline = null; // previous total_token_usage (running baseline)
    let lastPositiveTotal = 0;
    let tokenOrdinal = 0;

    for (const record of session.records) {
      const blocked = isTokenCount(record) && tokenOrdinal++ < skipPrefix;

      // Session timing: every record with a valid timestamp, except replay
      // blocks and non-first session_meta copies. turn_context and the first
      // session_meta mark user-side turn boundaries.
      const timestampMs = parseTimestampMs(record?.timestamp);
      if (timestampMs !== null && !blocked && (record === firstMeta || record?.type !== 'session_meta')) {
        sessionEvents.push({
          sessionId: session.sessionId,
          source: 'codex',
          project,
          timestamp: new Date(timestampMs),
          role: record === firstMeta || record?.type === 'turn_context' ? 'user' : 'assistant',
          ...(agentVersion ? { agentVersion } : {}),
        });
      }

      if (blocked) continue;

      if (record?.type === 'turn_context') {
        const model = record.payload?.model;
        if (typeof model === 'string' && model) stickyModel = model;
        const effort = record.payload?.effort;
        stickyEffort = typeof effort === 'string' && effort.trim() ? effort.trim() : null;
        continue;
      }

      if (!isTokenCount(record)) continue;
      if (timestampMs === null) continue; // invalid timestamp → skip the record

      const info = record.payload?.info;
      const total = info?.total_token_usage;

      // Bookkeeping dedup: a repeated positive total_tokens is a duplicate
      // emission (e.g. compaction bookkeeping) — skip the event entirely.
      const totalTokens = tokenCount(total?.total_tokens);
      if (totalTokens > 0 && totalTokens === lastPositiveTotal) continue;

      let delta;
      let current = null;
      if (total && typeof total === 'object') {
        current = {
          input_tokens: tokenCount(total.input_tokens),
          cached_input_tokens: tokenCount(total.cached_input_tokens ?? total.cache_read_input_tokens),
          cache_write_input_tokens: tokenCount(total.cache_write_input_tokens),
          output_tokens: tokenCount(total.output_tokens),
          reasoning_output_tokens: tokenCount(total.reasoning_output_tokens),
          total_tokens: tokenCount(total.total_tokens),
        };
      }
      if (info?.last_token_usage && typeof info.last_token_usage === 'object') {
        delta = info.last_token_usage;
      } else if (current) {
        if (!baseline) {
          delta = current;
        } else {
          const fields = Object.keys(current);
          const diff = Object.fromEntries(fields.map((field) => [field, current[field] - baseline[field]]));
          // Negative field → counter reset (compaction / new window): the
          // current total becomes a fresh baseline, i.e. the delta itself.
          delta = fields.some((field) => diff[field] < 0) ? current : diff;
        }
      } else {
        continue;
      }
      if (current) baseline = current;
      if (totalTokens > 0) lastPositiveTotal = totalTokens;

      // OpenAI fields overlap (cached ⊂ input, reasoning ⊂ output) — split
      // into mutually exclusive fields.
      const cached = tokenCount(delta.cached_input_tokens ?? delta.cache_read_input_tokens);
      const cacheWrite = tokenCount(delta.cache_write_input_tokens);
      const reasoning = tokenCount(delta.reasoning_output_tokens);
      const promptInputTokens = tokenCount(delta.input_tokens);
      const inputTokens = Math.max(0, promptInputTokens - cached - cacheWrite);
      const outputTokens = Math.max(0, tokenCount(delta.output_tokens) - reasoning);
      if (!inputTokens && !cached && !cacheWrite && !outputTokens && !reasoning) continue;

      const model = info?.model || record.payload?.model || stickyModel || 'unknown';
      const modelName = String(model).toLowerCase();
      const contextTier = modelName.startsWith('gpt-5.6')
        ? (promptInputTokens > 272_000 ? 'long' : 'short')
        : '';
      const rawProcessingTier = String(
        info?.service_tier || record.payload?.service_tier || '',
      ).trim().toLowerCase();
      const processingTier = new Set(['standard', 'batch', 'flex', 'priority'])
        .has(rawProcessingTier) ? rawProcessingTier : '';
      entries.push({
        source: 'codex',
        model,
        ...(modelProvider ? { modelProvider } : {}),
        ...(stickyEffort ? { reasoningEffort: stickyEffort } : {}),
        ...(agentVersion ? { agentVersion } : {}),
        ...(contextTier ? { contextTier } : {}),
        ...(processingTier ? { processingTier } : {}),
        project,
        timestamp: new Date(timestampMs),
        inputTokens,
        cacheWriteInputTokens: cacheWrite,
        cacheReadInputTokens: cached,
        outputTokens,
        reasoningOutputTokens: reasoning,
        requestCount: 1,
      });
    }
  }

  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(sessionEvents, sessionSalt),
  };
}
