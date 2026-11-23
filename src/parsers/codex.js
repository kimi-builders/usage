import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { zstdFileChunks } from './codex-zstd.js';
import { mergeContinuations } from './codex-continuations.js';
import { aggregateToBuckets, extractSessions } from './index.js';
import { configuredExtraRoots, discoverCodexHomes } from '../extra-roots.js';
import { compactCodexUsage, reconcileCodexUsage } from './codex-usage.js';
import { modelLeaf, openAiRequestContextTier } from '../model-meta.js';
import { codexTurnPerformance, compactCodexCompletion } from './codex-performance.js';

/**
 * Codex CLI parser (openai/codex).
 *
 * Rollout files live under <home>/sessions/ and <home>/archived_sessions/
 * (recursively, *.jsonl and compressed *.jsonl.zst; home = KBU_USAGE_CODEX_HOME, else
 * $CODEX_HOME, else ~/.codex). The same session can exist in both trees
 * (live + archive overlap). Copies of the same segment use its most complete
 * file; distinct resumed segments of the same session are merged in order.
 *
 * Durable `token_usage_record` and UI token_count mirrors are reconciled
 * before aggregation. Explicit request identities are session-scoped; copied
 * foreign-thread ledger records cannot contribute local usage.
 * Legacy accounting prefers `info.last_token_usage` (a per-request delta).
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
function resolveHomes(sourceOptions = {}) {
  const override = process.env.KBU_USAGE_CODEX_HOME?.trim();
  const extras = configuredExtraRoots(sourceOptions, 'codex').flatMap(discoverCodexHomes);
  if (override) return [...new Set([expandHome(override), ...extras])];
  const codexHome = process.env.CODEX_HOME?.trim();
  return [...new Set([
    codexHome ? expandHome(codexHome) : join(homedir(), '.codex'),
    ...extras,
  ])];
}

export function roots({ sourceOptions } = {}) {
  return resolveHomes(sourceOptions).filter((home) => existsSync(home));
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
        if (/\.jsonl(?:\.zst)?$/.test(entry.name)) {
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
// usage payloads only for Token records and allowlisted metadata for identity
// and model context; ordinary message/tool records retain timestamp + type only.
// `recordCount` preserves physical-copy winner selection exactly.
function metadataOnly(record) {
  const payload = record.payload || {};
  if (record.type === 'turn_context') return {
    type: record.type, timestamp: record.timestamp,
    payload: { model: payload.model, effort: payload.effort, turn_id: payload.turn_id,
      ...(Object.hasOwn(payload, 'service_tier') ? { service_tier: payload.service_tier } : {}) },
  };
  return {
    type: record.type, timestamp: record.timestamp,
    payload: {
      id: payload.id, session_id: payload.session_id, timestamp: payload.timestamp, cwd: payload.cwd,
      git: payload.git ? { repository_url: payload.git.repository_url } : undefined,
      cli_version: payload.cli_version, model_provider: payload.model_provider,
      forked_from_id: payload.forked_from_id, parent_thread_id: payload.parent_thread_id,
      thread_source: payload.thread_source,
      source: typeof payload.source === 'object' && payload.source !== null
        ? ('subagent' in payload.source ? { subagent: { thread_spawn: { parent_thread_id: payload.source.subagent?.thread_spawn?.parent_thread_id } } } : {})
        : payload.source,
    },
  };
}

async function readRollout(file) {
  const records = [];
  let meta = null;
  let recordCount = 0;
  let metaCount = 0;
  const compressed = file.path.endsWith('.zst');
  if (file.size > 0 || compressed) {
    const input = compressed ? Readable.from(zstdFileChunks(file.path, file.size), { objectMode: false })
      : createReadStream(file.path, {
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
          metaCount++;
          if (!meta) {
            meta = metadataOnly(raw);
            records.push(meta);
          }
          continue;
        }
        if (raw?.type === 'turn_context' || raw?.type === 'token_usage_record' || isTokenCount(raw)) {
          records.push(raw?.type === 'turn_context' ? metadataOnly(raw) : compactCodexUsage(raw));
          continue;
        }
        if (raw?.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(raw.payload?.type)) {
          records.push({ timestamp: raw.timestamp, type: raw.type, payload: compactCodexCompletion(raw.payload) });
          continue;
        }
        if (parseTimestampMs(raw?.timestamp) !== null) {
          records.push({ timestamp: raw.timestamp, type: raw.type,
            ...(raw.type === 'event_msg' ? { payload: { type: raw.payload?.type, turn_id: raw.payload?.turn_id,
              ...(['task_started', 'turn_started'].includes(raw.payload?.type) ? { started_at: raw.payload.started_at } : {}),
              ...(raw.payload?.type === 'thread_settings_applied' ? { thread_settings: {
                model: raw.payload.thread_settings?.model,
                ...(Object.hasOwn(raw.payload.thread_settings || {}, 'service_tier') ? { service_tier: raw.payload.thread_settings.service_tier } : {}),
              } } : {}) } } : {}),
          });
        }
      }
    } catch (error) {
      if (!compressed && error?.code === 'ENOENT') return null;
      throw error;
    } finally {
      lines.close();
      input.destroy();
    }
  }
  // Only the FIRST session_meta is canonical — later ones are copied parent
  // history. Without any meta, the session id falls back to the filename.
  const metaId = meta?.payload?.id;
  const sessionId = (typeof metaId === 'string' && metaId) || basename(file.path).replace(/\.jsonl(?:\.zst)?$/, '');
  const start = parseTimestampMs(meta?.timestamp) ?? parseTimestampMs(meta?.payload?.timestamp);
  return { file, records, recordCount, meta, metaCount, sessionId, start };
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

// Linear prefix matching: forks can copy only the last turns; an active
// subagent may still be appending an interior slice of its parent's history.
function replayPrefix(child, parent, allowPartial) {
  if (!child.length || !parent.length) return 0;
  const table = new Uint32Array(child.length);
  for (let i = 1, j = 0; i < child.length; i++) {
    while (j && child[i] !== child[j]) j = table[j - 1];
    if (child[i] === child[j]) j++;
    table[i] = j;
  }
  let j = 0, longest = 0;
  for (const value of parent) {
    while (j && (j === child.length || value !== child[j])) j = table[j - 1];
    if (value === child[j]) j++;
    longest = Math.max(longest, j);
  }
  return allowPartial ? longest : j;
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

function segmentMetadata(payload) {
  return { project: projectFrom(payload),
    agentVersion: typeof payload?.cli_version === 'string' ? payload.cli_version.trim() : '',
    modelProvider: typeof payload?.model_provider === 'string' ? payload.model_provider.trim() : '' };
}

export async function parse({ sessionSalt, sourceOptions, includePerformance = false } = {}) {
  const homes = roots({ sourceOptions });
  if (homes.length === 0) return null;

  // Most complete copy per session/segment; ties prefer the smallest path.
  const groups = new Map();
  const warnings = [];
  let unreadableArchives = 0;
  for (const home of homes) {
    for (const file of findRolloutFiles(home)) {
      let rollout;
      try {
        rollout = await readRollout(file);
      } catch (error) {
        if (!file.path.endsWith('.jsonl.zst')) throw error;
        unreadableArchives++;
        continue; // Discard this whole archive, keep readable siblings and the old checkpoint.
      }
      if (!rollout) continue;
      // A distinct first session_meta timestamp marks a resumed segment. A
      // live/archive copy of the same segment retains its original header.
      if (!groups.has(rollout.sessionId)) groups.set(rollout.sessionId, new Map());
      const segments = groups.get(rollout.sessionId);
      const current = segments.get(rollout.start);
      if (!current || rollout.recordCount > current.recordCount
        || (rollout.recordCount === current.recordCount && rollout.file.path < current.file.path)) {
        segments.set(rollout.start, rollout);
      }
    }
  }
  const sessions = [];
  for (const segments of groups.values()) {
    const group = [...segments.values()];
    const merged = mergeContinuations(group, segmentMetadata);
    if (merged) sessions.push(merged);
    else {
      sessions.push(group.reduce((a, b) => a.recordCount >= b.recordCount ? a : b));
      if (warnings.length < 20) warnings.push('codex: conflicting continuation order; only the most complete segment was used');
    }
  }
  groups.clear();
  if (unreadableArchives) warnings.push(`codex: ${unreadableArchives} compressed rollout(s) could not be read; check file integrity and use Node >=22.15 or install zstd`);
  const turnPerformance = [];
  for (const session of sessions) {
    if (includePerformance) turnPerformance.push(...codexTurnPerformance(
      session.records, session.sessionId, session.meta?.payload?.session_id || session.sessionId,
      segmentMetadata(session.meta?.payload),
    ));
    const reconciled = reconcileCodexUsage(session.records, session.sessionId, session.meta?.payload?.session_id || session.sessionId);
    session.records = reconciled.records;
    for (const warning of reconciled.warnings) warnings.push(warning);
  }

  // Per-session token_count fingerprint sequences (record order) — needed
  // both for the parent's replay snapshot and the child's prefix skip.
  const fingerprints = new Map();
  for (const session of sessions) {
    const sequence = [];
    for (const record of session.records) {
      if (!isTokenCount(record)) continue;
      const info = record.payload?.info;
      sequence.push({
        owned: record.ownedRequest === true,
        cumulative: tokenCount(info?.total_token_usage?.total_tokens) > 0,
        fingerprint: tokenFingerprint(info?.model ?? record.payload?.model, info),
        timestampMs: parseTimestampMs(record.timestamp),
      });
    }
    fingerprints.set(session.sessionId, sequence);
  }

  const entries = [];
  const sessionResults = [];

  for (const session of sessions) {
    const sessionEvents = [];
    const payload = session.meta?.payload;
    const firstMetadata = segmentMetadata(payload);
    const sessionProjects = new Set();

    // Fork cutoff: the child replays parent history up to its own start.
    const startedAtMs = payload
      ? parseTimestampMs(payload.timestamp) ?? parseTimestampMs(session.meta?.timestamp)
      : null;

    // Replay skip: longest child prefix matching a suffix of the parent's
    // pre-fork fingerprint sequence. Parent missing from this scan → fail
    // open (count everything).
    let skipPrefix = 0;
    let taskBoundary = -1;
    if (payload && isChildSession(payload)) {
      const subagent = Boolean(payload.parent_thread_id || payload.thread_source === 'subagent' || payload.source === 'subagent' || payload.source?.subagent);
      const parentSequence = fingerprints.get(parentIdOf(payload));
      if (parentSequence) {
        const snapshot = parentSequence
          .filter((event) => event.timestampMs !== null && startedAtMs !== null && event.timestampMs <= startedAtMs)
          .map((event) => event.fingerprint);
        // An explicitly owned ledger request ends the inherited prefix,
        // even if two distinct requests happened to use identical counters.
        const leading = [];
        let proven = 0;
        for (const event of fingerprints.get(session.sessionId)) {
          if (event.owned) break;
          if (event.cumulative && proven === leading.length) proven++;
          leading.push(event.fingerprint);
        }
        skipPrefix = replayPrefix(leading, snapshot, false);
        if (subagent && proven > skipPrefix) {
          skipPrefix = Math.max(skipPrefix, replayPrefix(leading.slice(0, proven), snapshot, true));
        }
      }
      if (subagent) {
        // The child's own task follows inherited transcript rows, including
        // replays whose old parent file is no longer available. A second
        // session_meta means the first task marker may itself be a copy.
        let first = -1;
        let closestEarly = Infinity;
        for (const [i, record] of session.records.entries()) {
          if (record.ownedRequest) break;
          if (record.type !== 'event_msg' || !['task_started', 'turn_started'].includes(record.payload?.type)) continue;
          if (first < 0) first = i;
          const value = record.payload.started_at;
          const epoch = (typeof value === 'number' || typeof value === 'string' && value.trim()) ? Number(value) : NaN;
          if (startedAtMs === null || !Number.isFinite(epoch)) continue;
          const seconds = epoch < 1e12;
          const marker = seconds ? epoch * 1000 : epoch;
          const distance = Math.abs(marker - startedAtMs);
          if (distance > 5000) continue;
          // Do not prefer a copied, slightly earlier parent marker over the
          // first child turn. Whole-second markers can truncate the header.
          const earliest = seconds && Number.isInteger(epoch) ? Math.floor(startedAtMs / 1000) * 1000 : startedAtMs;
          if (marker >= earliest) { taskBoundary = i; break; }
          if (distance < closestEarly) { closestEarly = distance; taskBoundary = i; }
        }
        if (taskBoundary < 0 && session.metaCount === 1 && !payload.forked_from_id) taskBoundary = first;
      }
    }

    const firstMeta = session.meta;
    let stickyModel = null;
    let stickyEffort = null;
    let stickyTier = null;
    let tokenOrdinal = 0;

    for (const [index, record] of session.records.entries()) {
      const { project, agentVersion, modelProvider } = record.segmentMetadata || firstMetadata;
      const replayToken = isTokenCount(record) && tokenOrdinal++ < skipPrefix;
      const blocked = replayToken || (index < taskBoundary && record !== firstMeta);

      // Session timing: every record with a valid timestamp, except replay
      // blocks and non-first session_meta copies. turn_context and the first
      // session_meta mark user-side turn boundaries.
      const timestampMs = parseTimestampMs(record?.timestamp);
      if (timestampMs !== null && !blocked && (record === firstMeta || record?.type !== 'session_meta')) {
        sessionProjects.add(project);
        sessionEvents.push({
          sessionId: session.sessionId,
          source: 'codex',
          project,
          timestamp: new Date(timestampMs),
          role: record === firstMeta || record?.type === 'turn_context' ? 'user' : 'assistant',
          ...(agentVersion ? { agentVersion } : {}),
        });
      }

      if (record?.type === 'turn_context') {
        const model = record.payload?.model;
        if (typeof model === 'string' && model) stickyModel = model;
        const effort = record.payload?.effort;
        stickyEffort = typeof effort === 'string' && effort.trim() ? effort.trim() : null;
        if (Object.hasOwn(record.payload, 'service_tier')) stickyTier = record.payload.service_tier;
        continue;
      }
      if (record?.type === 'event_msg' && record.payload?.type === 'thread_settings_applied') {
        const settings = record.payload.thread_settings;
        if (settings?.model) stickyModel = settings.model;
        if (Object.hasOwn(settings || {}, 'service_tier')) stickyTier = settings.service_tier;
      }
      if (blocked) continue;
      if (!isTokenCount(record)) continue;
      if (timestampMs === null) continue; // invalid timestamp → skip the record

      const info = record.payload?.info;
      const delta = info?.last_token_usage;
      if (!delta) continue;

      // OpenAI fields overlap (cached ⊂ input, reasoning ⊂ output) — split
      // into mutually exclusive fields.
      const cached = tokenCount(delta.cached_input_tokens ?? delta.cache_read_input_tokens);
      const cacheWrite = tokenCount(delta.cache_write_input_tokens);
      const reasoning = tokenCount(delta.reasoning_output_tokens);
      const promptInputTokens = tokenCount(delta.input_tokens);
      const inputTokens = Math.max(0, promptInputTokens - cached - cacheWrite);
      const outputTokens = Math.max(0, tokenCount(delta.output_tokens) - reasoning);
      if (!inputTokens && !cached && !cacheWrite && !outputTokens && !reasoning) continue;

      const context = record.segmentContext || { model: stickyModel, effort: stickyEffort, tier: stickyTier };
      const model = info?.model || record.payload?.model || context.model || 'unknown';
      const pricedModelName = modelLeaf(model).toLowerCase();
      const contextTier = openAiRequestContextTier(model, promptInputTokens);
      const rawProcessingTier = String(
        info?.service_tier || record.payload?.service_tier || context.tier || '',
      ).trim().toLowerCase();
      // OpenAI's Fast mode is the existing priority tier, not Standard.
      const serviceTier = rawProcessingTier === 'fast' && /^gpt-6\.2-(?:astra|sol)$/.test(pricedModelName)
        ? 'priority' : rawProcessingTier;
      const processingTier = new Set(['standard', 'batch', 'flex', 'priority', 'ultrafast'])
        .has(serviceTier) ? serviceTier : '';
      entries.push({
        source: 'codex',
        model,
        ...(modelProvider ? { modelProvider } : {}),
        ...(context.effort ? { reasoningEffort: context.effort } : {}),
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
    const [summary] = extractSessions(sessionEvents, sessionSalt);
    if (summary) sessionResults.push(sessionProjects.size > 1 ? { ...summary, project: 'unknown' } : summary);
    session.records = []; // Replay matching below uses the compact fingerprints, not the transcript.
  }

  return {
    buckets: aggregateToBuckets(entries),
    sessions: sessionResults,
    ...(includePerformance ? { turnPerformance } : {}),
    ...(warnings.length ? { skipped: true, warnings } : {}),
  };
}
