import { basename, join, sep } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { aggregateToBuckets, extractSessions } from './index.js';
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
  const split = tokenCount(usage.cache_creation?.ephemeral_5m_input_tokens)
    + tokenCount(usage.cache_creation?.ephemeral_1h_input_tokens);
  return Math.max(tokenCount(usage.cache_creation_input_tokens), split);
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

function readJsonl(candidate, onObject) {
  const content = readFileSync(candidate.filePath).subarray(0, candidate.size).toString('utf8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      onObject(JSON.parse(line));
    } catch {
      // Isolate malformed/appending records. The next sync sees completed data.
    }
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
  };
}

function scanProjectCandidate(candidate) {
  const entries = [];
  const events = [];
  let lastModel = null;
  let sessionProject = candidate.fallbackProject;
  let foundSessionCwd = false;
  readJsonl(candidate, (record) => {
    if (!foundSessionCwd && typeof record.cwd === 'string' && record.cwd.trim()) {
      sessionProject = projectFromCwd(record.cwd, candidate.fallbackProject);
      foundSessionCwd = true;
    }
    const event = timingEvent(record, candidate.sessionId, sessionProject);
    if (event) events.push(event);
    const usage = record.message?.usage;
    if (record.type !== 'assistant' || !usage || typeof usage !== 'object') return;
    const timestamp = new Date(record.timestamp);
    if (!record.timestamp || Number.isNaN(timestamp.getTime())) return;
    const rawModel = typeof record.message.model === 'string' ? record.message.model.trim() : '';
    if (rawModel && rawModel !== '<synthetic>') lastModel = rawModel;
    const inputTokens = tokenCount(usage.input_tokens);
    const cacheWriteInputTokens = cacheCreationTokens(usage);
    const cacheReadInputTokens = tokenCount(usage.cache_read_input_tokens);
    const outputTokens = tokenCount(usage.output_tokens);
    const usageScore = inputTokens + cacheWriteInputTokens + cacheReadInputTokens + outputTokens;
    if (usageScore === 0) return;
    entries.push({
      uuid: typeof record.uuid === 'string' && record.uuid ? record.uuid : null,
      usageScore,
      source: 'claude-code',
      model: rawModel && rawModel !== '<synthetic>' ? rawModel : lastModel || 'unknown',
      project: sessionProject,
      timestamp,
      inputTokens,
      cacheWriteInputTokens,
      cacheReadInputTokens,
      outputTokens,
      reasoningOutputTokens: 0,
      requestCount: 1,
    });
  });
  for (const entry of entries) entry.project = sessionProject;
  for (const event of events) event.project = sessionProject;
  return { entries, events };
}

function scanTranscriptCandidate(candidate) {
  const events = [];
  readJsonl(candidate, (record) => {
    const event = timingEvent(
      record,
      candidate.sessionId,
      projectFromCwd(record.cwd, 'unknown'),
    );
    if (event) events.push(event);
  });
  return { entries: [], events };
}

function scanBestCandidate(candidates, scanner, ctx) {
  for (const candidate of candidates) {
    try {
      return scanner(candidate);
    } catch (error) {
      addWarning(ctx, `Claude Code: cannot read ${candidate.filePath}: ${error.message}`);
    }
  }
  return null;
}

function mergeUsageEntry(ctx, entry) {
  if (!entry.uuid) {
    ctx.anonymousEntries.push(entry);
    return;
  }
  const current = ctx.entriesByUuid.get(entry.uuid);
  if (!current || entry.usageScore > current.usageScore) ctx.entriesByUuid.set(entry.uuid, entry);
}

export async function parse({ sessionSalt } = {}) {
  const ctx = {
    entriesByUuid: new Map(),
    anonymousEntries: [],
    sessionEvents: [],
    warnings: [],
    incomplete: false,
  };
  const scanRoots = getClaudeRoots({ onWarning: (message) => addWarning(ctx, message) });
  if (scanRoots.length === 0) return null;

  const projectGroups = collectCandidates(scanRoots, 'projects', ctx);
  const projectSessionIds = new Set();
  for (const [sessionId, candidates] of projectGroups) {
    const parsed = scanBestCandidate(candidates, scanProjectCandidate, ctx);
    if (!parsed) continue;
    projectSessionIds.add(sessionId);
    ctx.sessionEvents.push(...parsed.events);
    for (const entry of parsed.entries) mergeUsageEntry(ctx, entry);
  }

  const transcriptGroups = collectCandidates(scanRoots, 'transcripts', ctx);
  for (const [sessionId, candidates] of transcriptGroups) {
    if (projectSessionIds.has(sessionId)) continue;
    const parsed = scanBestCandidate(candidates, scanTranscriptCandidate, ctx);
    if (parsed) ctx.sessionEvents.push(...parsed.events);
  }

  const entries = [...ctx.anonymousEntries, ...ctx.entriesByUuid.values()]
    .map(({ uuid: _uuid, usageScore: _usageScore, ...entry }) => entry);
  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(ctx.sessionEvents, sessionSalt),
    ...(ctx.incomplete ? { skipped: true } : {}),
    ...(ctx.warnings.length > 0 ? { warnings: ctx.warnings } : {}),
  };
}
