import { basename, join, sep } from 'node:path';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  accumulateSessionEvent,
  aggregateToBuckets,
  createSessionAccumulator,
  extractSessions,
  finalizeSessionAccumulator,
  sessionAccumulatorIsOrdered,
} from './index.js';
import { getClaudeRoots } from '../claude-roots.js';

const MAX_WARNINGS = 20;

function addWarning(ctx, message) {
  ctx.incomplete = true;
  if (ctx.warnings.length < MAX_WARNINGS) ctx.warnings.push(message);
}

export function roots() {
  return getClaudeRoots();
}

function findJsonlFiles(dir, ctx) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      addWarning(ctx, `Claude Code: cannot read directory ${dir}: ${error.message}`);
    }
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findJsonlFiles(fullPath, ctx));
    else if (entry.name.endsWith('.jsonl')) files.push(fullPath);
  }
  return files;
}

function projectFromRelative(filePath, baseDir) {
  const prefix = `${baseDir}${sep}`;
  if (!filePath.startsWith(prefix)) return 'unknown';
  const firstSegment = filePath.slice(prefix.length).split(sep)[0];
  const parts = firstSegment.split('-').filter(Boolean);
  return parts.at(-1) || 'unknown';
}

function projectFromCwd(cwd, fallback) {
  if (typeof cwd !== 'string') return fallback;
  const trimmed = cwd.trim().replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function cacheCreationTokens(usage) {
  const fiveMinute = tokenCount(usage.cache_creation?.ephemeral_5m_input_tokens);
  const oneHour = tokenCount(usage.cache_creation?.ephemeral_1h_input_tokens);
  const split = fiveMinute + oneHour;
  const total = Math.max(tokenCount(usage.cache_creation_input_tokens), split);
  return { total, fiveMinute, oneHour };
}

function candidateIsBetter(next, current) {
  if (!current) return true;
  if (next.size !== current.size) return next.size > current.size;
  if (next.mtimeMs !== current.mtimeMs) return next.mtimeMs > current.mtimeMs;
  return next.filePath.localeCompare(current.filePath) < 0;
}

function collectCandidates(scanRoots, directoryName, ctx) {
  const groups = new Map();
  for (const root of scanRoots) {
    const baseDir = join(root, directoryName);
    for (const filePath of findJsonlFiles(baseDir, ctx)) {
      let stat;
      try {
        stat = statSync(filePath);
      } catch (error) {
        addWarning(ctx, `Claude Code: cannot stat ${filePath}: ${error.message}`);
        continue;
      }
      const sessionId = basename(filePath, '.jsonl');
      const group = groups.get(sessionId) || [];
      group.push({
        filePath,
        sessionId,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        fallbackProject: directoryName === 'projects'
          ? projectFromRelative(filePath, baseDir)
          : 'unknown',
      });
      groups.set(sessionId, group);
    }
  }
  for (const group of groups.values()) {
    group.sort((left, right) => (
      candidateIsBetter(left, right) ? -1 : candidateIsBetter(right, left) ? 1 : 0
    ));
  }
  return groups;
}

async function readJsonl(candidate, onObject) {
  if (candidate.size <= 0) return;
  const input = createReadStream(candidate.filePath, {
    encoding: 'utf8',
    end: candidate.size - 1,
    highWaterMark: 256 * 1024,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        onObject(JSON.parse(line));
      } catch {
        // Isolate malformed/appending records. The next sync sees completed data.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

function timingEvent(record, sessionId, project) {
  if (!new Set(['user', 'assistant', 'tool_use', 'tool_result']).has(record.type)) return null;
  const timestamp = new Date(record.timestamp);
  if (!record.timestamp || Number.isNaN(timestamp.getTime())) return null;
  return {
    sessionId,
    source: 'claude-code',
    project,
    timestamp,
    role: record.type === 'user' ? 'user' : 'assistant',
    ...(typeof record.version === 'string' && record.version.trim()
      ? { agentVersion: record.version.trim() }
      : {}),
  };
}

async function collectTimingEvents(candidate, projectForRecord) {
  const events = [];
  await readJsonl(candidate, (record) => {
    const event = timingEvent(record, candidate.sessionId, projectForRecord(record));
    if (event) events.push(event);
  });
  return events;
}

async function finalizeCandidateSession(
  candidate,
  accumulator,
  sessionSalt,
  projectForRecord,
  projectOverride,
) {
  if (sessionAccumulatorIsOrdered(accumulator)) {
    return finalizeSessionAccumulator(
      accumulator,
      candidate.sessionId,
      sessionSalt,
      projectOverride,
    );
  }
  // JSONL normally appends in timestamp order. Preserve the shared extractor's
  // sort semantics for copied/rewritten files by re-reading only that file.
  const events = await collectTimingEvents(candidate, projectForRecord);
  const session = extractSessions(events, sessionSalt)[0] || null;
  return session && projectOverride ? { ...session, project: projectOverride } : session;
}

async function scanProjectCandidate(candidate, sessionSalt) {
  const usageEntries = newUsageIndex();
  const sessionAccumulator = createSessionAccumulator();
  let lastModel = null;
  let sessionProject = candidate.fallbackProject;
  let foundSessionCwd = false;
  await readJsonl(candidate, (record) => {
    if (!foundSessionCwd && typeof record.cwd === 'string' && record.cwd.trim()) {
      sessionProject = projectFromCwd(record.cwd, candidate.fallbackProject);
      foundSessionCwd = true;
    }
    const event = timingEvent(record, candidate.sessionId, sessionProject);
    if (event) accumulateSessionEvent(sessionAccumulator, event);
    const usage = record.message?.usage;
    if (record.type !== 'assistant' || !usage || typeof usage !== 'object') return;
    const timestamp = new Date(record.timestamp);
    if (!record.timestamp || Number.isNaN(timestamp.getTime())) return;
    const rawModel = typeof record.message.model === 'string' ? record.message.model.trim() : '';
    if (rawModel && rawModel !== '<synthetic>') lastModel = rawModel;
    const inputTokens = tokenCount(usage.input_tokens);
    const cacheWrite = cacheCreationTokens(usage);
    const cacheWriteInputTokens = cacheWrite.total;
    const cacheReadInputTokens = tokenCount(usage.cache_read_input_tokens);
    const outputTokens = tokenCount(usage.output_tokens);
    const usageScore = inputTokens + cacheWriteInputTokens + cacheReadInputTokens + outputTokens;
    if (usageScore === 0) return;
    // Claude writes several content blocks and streaming snapshots for one
    // API call. Their line UUIDs differ but the provider call identity does not.
    const id = typeof record.message.id === 'string' ? record.message.id.trim() : '';
    const request = typeof record.requestId === 'string' ? record.requestId.trim() : '';
    collectUsageEntry(usageEntries, {
      uuid: typeof record.uuid === 'string' ? record.uuid : '', id, request,
      usageScore,
      source: 'claude-code',
      model: rawModel && rawModel !== '<synthetic>' ? rawModel : lastModel || 'unknown',
      ...(typeof record.version === 'string' && record.version.trim()
        ? { agentVersion: record.version.trim() }
        : {}),
      project: sessionProject,
      timestamp,
      inputTokens,
      cacheWriteInputTokens,
      cacheWrite5mInputTokens: cacheWrite.fiveMinute,
      cacheWrite1hInputTokens: cacheWrite.oneHour,
      cacheReadInputTokens,
      outputTokens,
      reasoningOutputTokens: 0,
      requestCount: 1,
    });
  });
  for (const entry of indexedEntries(usageEntries)) entry.project = sessionProject;
  const session = await finalizeCandidateSession(
    candidate,
    sessionAccumulator,
    sessionSalt,
    () => sessionProject,
    sessionProject,
  );
  return { usageEntries, session };
}

async function scanTranscriptCandidate(candidate, sessionSalt) {
  const sessionAccumulator = createSessionAccumulator();
  const projectForRecord = (record) => projectFromCwd(record.cwd, 'unknown');
  await readJsonl(candidate, (record) => {
    const event = timingEvent(
      record,
      candidate.sessionId,
      projectForRecord(record),
    );
    if (event) accumulateSessionEvent(sessionAccumulator, event);
  });
  const session = await finalizeCandidateSession(
    candidate,
    sessionAccumulator,
    sessionSalt,
    projectForRecord,
  );
  return { session };
}

async function scanBestCandidate(candidates, scanner, ctx, sessionSalt) {
  for (const candidate of candidates) {
    try {
      return await scanner(candidate, sessionSalt);
    } catch (error) {
      addWarning(ctx, `Claude Code: cannot read ${candidate.filePath}: ${error.message}`);
    }
  }
  return null;
}

function newUsageIndex() {
  return { lines: new Map(), calls: new Map(), anonymous: [] };
}

function* indexedEntries(index) {
  for (const rows of index.lines.values()) yield* rows;
  yield* index.calls.values();
  yield* index.anonymous;
}

function mergeCall(index, entry) {
  if (!entry.id && !entry.request) { index.anonymous.push(entry); return; }
  const key = JSON.stringify([entry.id, entry.request]);
  const previous = index.calls.get(key);
  if (!previous || entry.usageScore > previous.usageScore) index.calls.set(key, entry);
}

function collectUsageEntry(index, entry) {
  if (!entry.uuid) { mergeCall(index, entry); return; }
  let rows = index.lines.get(entry.uuid);
  if (!rows) { index.lines.set(entry.uuid, [entry]); return; }
  // A copied/streamed line can gain IDs without gaining tokens. Keep both
  // the strongest counters and the most complete compatible identity.
  for (const [i, old] of rows.entries()) {
    if (old.id && entry.id && old.id !== entry.id || old.request && entry.request && old.request !== entry.request) continue;
    rows[i] = { ...(entry.usageScore > old.usageScore ? entry : old), id: old.id || entry.id, request: old.request || entry.request };
    return;
  }
  rows.push(entry); // conflicting explicit IDs are not evidence of the same call
}

export async function parse({ sessionSalt } = {}) {
  const ctx = {
    ...newUsageIndex(),
    sessions: [],
    warnings: [],
    incomplete: false,
  };
  const scanRoots = getClaudeRoots({ onWarning: (message) => addWarning(ctx, message) });
  if (scanRoots.length === 0) return null;

  const projectGroups = collectCandidates(scanRoots, 'projects', ctx);
  const projectSessionIds = new Set();
  for (const [sessionId, candidates] of projectGroups) {
    const parsed = await scanBestCandidate(
      candidates,
      scanProjectCandidate,
      ctx,
      sessionSalt,
    );
    if (!parsed) continue;
    projectSessionIds.add(sessionId);
    if (parsed.session) ctx.sessions.push(parsed.session);
    for (const entry of indexedEntries(parsed.usageEntries)) collectUsageEntry(ctx, entry);
  }

  const transcriptGroups = collectCandidates(scanRoots, 'transcripts', ctx);
  for (const [sessionId, candidates] of transcriptGroups) {
    if (projectSessionIds.has(sessionId)) continue;
    const parsed = await scanBestCandidate(
      candidates,
      scanTranscriptCandidate,
      ctx,
      sessionSalt,
    );
    if (parsed?.session) ctx.sessions.push(parsed.session);
  }

  for (const rows of ctx.lines.values()) for (const entry of rows) mergeCall(ctx, entry);
  ctx.lines.clear();
  return {
    // Aggregation projects only the public bucket fields, never raw IDs.
    buckets: aggregateToBuckets(indexedEntries(ctx)),
    sessions: ctx.sessions,
    ...(ctx.incomplete ? { skipped: true } : {}),
    ...(ctx.warnings.length > 0 ? { warnings: ctx.warnings } : {}),
  };
}
