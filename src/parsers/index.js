import { createHmac } from 'node:crypto';
import { parse as parseKimiCode, roots as kimiCodeRoots } from './kimi-code.js';
import { parse as parseClaudeCode, roots as claudeCodeRoots } from './claude-code.js';
import { parse as parseCodex, roots as codexRoots } from './codex.js';
import { parse as parseOpenCode, roots as openCodeRoots } from './opencode.js';
import { parse as parseGeminiCli, roots as geminiCliRoots } from './gemini-cli.js';
import { parse as parseAntigravity, roots as antigravityRoots } from './antigravity.js';
import { parse as parseCopilotCli, roots as copilotCliRoots } from './copilot-cli.js';
import { parse as parseRooCode, roots as rooCodeRoots } from './roo-code.js';
import { parse as parseCursor, roots as cursorRoots } from './cursor.js';
import { parse as parsePiCodingAgent, roots as piCodingAgentRoots } from './pi-coding-agent.js';
import { parse as parseZcode, roots as zcodeRoots } from './zcode.js';
import { parse as parseWorkbuddy, roots as workbuddyRoots } from './workbuddy.js';
import { parse as parseGrok, roots as grokRoots } from './grok.js';
import { parse as parseTraeCli, roots as traeCliRoots } from './trae-cli.js';
import { parse as parseMcode, roots as mcodeRoots } from './mcode.js';
import { canonicalModelId } from '../model-meta.js';

// Multi-source registry. Tiers: core (always on), stable (on), beta (on with
// an explicit compatibility caveat), explicit-opt-in (configured by user).
// `roots()` returns the absolute dirs the source would scan right now (only
// dirs that exist) — an empty list means "not installed" and the collector
// marks the source skipped without calling parse.
export const sourceRegistry = [
  { id: 'kimi-code', tier: 'core', parse: parseKimiCode, roots: kimiCodeRoots },
  { id: 'claude-code', tier: 'stable', parse: parseClaudeCode, roots: claudeCodeRoots },
  { id: 'codex', tier: 'stable', parse: parseCodex, roots: codexRoots },
  { id: 'opencode', tier: 'stable', parse: parseOpenCode, roots: openCodeRoots },
  { id: 'gemini-cli', tier: 'stable', parse: parseGeminiCli, roots: geminiCliRoots },
  { id: 'antigravity', tier: 'stable', parse: parseAntigravity, roots: antigravityRoots },
  { id: 'copilot-cli', tier: 'stable', parse: parseCopilotCli, roots: copilotCliRoots },
  { id: 'roo-code', tier: 'stable', parse: parseRooCode, roots: rooCodeRoots },
  { id: 'pi-coding-agent', tier: 'beta', parse: parsePiCodingAgent, roots: piCodingAgentRoots },
  { id: 'zcode', tier: 'beta', parse: parseZcode, roots: zcodeRoots },
  { id: 'workbuddy', tier: 'beta', parse: parseWorkbuddy, roots: workbuddyRoots },
  { id: 'grok', tier: 'beta', parse: parseGrok, roots: grokRoots },
  { id: 'trae-cli', tier: 'beta', parse: parseTraeCli, roots: traeCliRoots },
  { id: 'mcode', tier: 'beta', parse: parseMcode, roots: mcodeRoots },
  { id: 'cursor', tier: 'explicit-opt-in', parse: parseCursor, roots: cursorRoots },
];

export function enabledSources(optionalSourceIds = []) {
  const optional = new Set(optionalSourceIds);
  return sourceRegistry.filter((source) =>
    ['core', 'stable', 'beta'].includes(source.tier) || optional.has(source.id));
}

// Back-compat id → parse map, built from the registry.
export const parsers = Object.fromEntries(sourceRegistry.map((source) => [source.id, source.parse]));

export function roundToHalfHour(date) {
  const value = new Date(date);
  value.setUTCMinutes(value.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return value;
}

function tokenCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.round(number);
}

export function aggregateToBuckets(entries) {
  const buckets = new Map();
  for (const entry of entries) {
    const model = String(entry.model || 'unknown').slice(0, 160);
    const modelProvider = String(entry.modelProvider || '').trim().slice(0, 80);
    const modelCanonical = String(
      entry.modelCanonical || canonicalModelId({ ...entry, model }),
    ).trim().slice(0, 160);
    const reasoningEffort = String(entry.reasoningEffort || '').trim().toLowerCase().slice(0, 32);
    const agentVersion = String(entry.agentVersion || '').trim().slice(0, 80);
    const contextTier = String(entry.contextTier || '').trim().toLowerCase().slice(0, 16);
    const processingTier = String(entry.processingTier || '').trim().toLowerCase().slice(0, 16);
    const project = String(entry.project || 'unknown').slice(0, 120);
    const bucketStart = roundToHalfHour(entry.timestamp).toISOString();
    const key = [
      entry.source,
      model,
      modelProvider,
      reasoningEffort,
      agentVersion,
      contextTier,
      processingTier,
      project,
      bucketStart,
    ]
      .join('|');
    if (!buckets.has(key)) {
      buckets.set(key, {
        source: entry.source,
        model,
        ...(modelCanonical ? { modelCanonical } : {}),
        ...(modelProvider ? { modelProvider } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(agentVersion ? { agentVersion } : {}),
        ...(contextTier ? { contextTier } : {}),
        ...(processingTier ? { processingTier } : {}),
        project,
        bucketStart,
        inputTokens: 0,
        cacheWriteInputTokens: 0,
        cacheWrite5mInputTokens: 0,
        cacheWrite1hInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        requestCount: 0,
        measurement: 'exact',
      });
    }
    const bucket = buckets.get(key);
    bucket.inputTokens += entry.inputTokens || 0;
    bucket.cacheWriteInputTokens += entry.cacheWriteInputTokens || 0;
    bucket.cacheWrite5mInputTokens += entry.cacheWrite5mInputTokens || 0;
    bucket.cacheWrite1hInputTokens += entry.cacheWrite1hInputTokens || 0;
    bucket.cacheReadInputTokens += entry.cacheReadInputTokens || 0;
    bucket.outputTokens += entry.outputTokens || 0;
    bucket.reasoningOutputTokens += entry.reasoningOutputTokens || 0;
    bucket.requestCount += entry.requestCount || 1;
  }
  return Array.from(buckets.values()).map((bucket) => {
    const {
      cacheWrite5mInputTokens,
      cacheWrite1hInputTokens,
      ...base
    } = bucket;
    return {
      ...base,
      inputTokens: tokenCount(bucket.inputTokens),
      cacheWriteInputTokens: tokenCount(bucket.cacheWriteInputTokens),
      ...(cacheWrite5mInputTokens > 0
        ? { cacheWrite5mInputTokens: tokenCount(cacheWrite5mInputTokens) }
        : {}),
      ...(cacheWrite1hInputTokens > 0
        ? { cacheWrite1hInputTokens: tokenCount(cacheWrite1hInputTokens) }
        : {}),
      cacheReadInputTokens: tokenCount(bucket.cacheReadInputTokens),
      outputTokens: tokenCount(bucket.outputTokens),
      reasoningOutputTokens: tokenCount(bucket.reasoningOutputTokens),
      requestCount: tokenCount(bucket.requestCount),
    };
  });
}

const ACTIVE_GAP_CAP_MILLISECONDS = 5 * 60 * 1000;
const DURATION_GAP_CAP_MILLISECONDS = 30 * 60 * 1000;

function ensureActivityHour(accumulator, date) {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  const key = hour.toISOString();
  if (!accumulator.activityByHour.has(key)) {
    accumulator.activityByHour.set(key, {
      hourStart: key,
      activeMilliseconds: 0,
      engagedMilliseconds: 0,
      messageCount: 0,
      userMessageCount: 0,
    });
  }
  return accumulator.activityByHour.get(key);
}

function addActivitySpan(accumulator, field, start, milliseconds) {
  let cursor = start.getTime();
  let remaining = milliseconds;
  while (remaining > 0) {
    const hourEnd = Math.floor(cursor / 3_600_000) * 3_600_000 + 3_600_000;
    const chunk = Math.min(remaining, hourEnd - cursor);
    ensureActivityHour(accumulator, new Date(cursor))[field] += chunk;
    cursor += chunk;
    remaining -= chunk;
  }
}

/** Incremental equivalent of extractSessions for chronological parser streams. */
export function createSessionAccumulator() {
  return {
    ordered: true,
    first: null,
    last: null,
    lastTimestampMs: null,
    latestAgentVersion: '',
    previousTurnEvent: null,
    previousAssistant: null,
    activityByHour: new Map(),
    userPromptHours: new Array(24).fill(0),
    userMessageCount: 0,
  };
}

export function accumulateSessionEvent(accumulator, event) {
  const timestampMs = event.timestamp.getTime();
  if (accumulator.lastTimestampMs !== null && timestampMs < accumulator.lastTimestampMs) {
    accumulator.ordered = false;
  }
  if (accumulator.first === null) accumulator.first = event;
  accumulator.last = event;
  accumulator.lastTimestampMs = timestampMs;
  const agentVersion = String(event.agentVersion || '').trim();
  if (agentVersion) accumulator.latestAgentVersion = agentVersion;

  ensureActivityHour(accumulator, event.timestamp).messageCount += 1;
  if (event.role === 'user') {
    ensureActivityHour(accumulator, event.timestamp).userMessageCount += 1;
    accumulator.userMessageCount += 1;
    accumulator.userPromptHours[event.timestamp.getUTCHours()] += 1;
    accumulator.previousTurnEvent = event;
    accumulator.previousAssistant = null;
    return;
  }
  if (accumulator.previousTurnEvent !== null) {
    const gapMilliseconds = Math.max(
      0,
      event.timestamp - accumulator.previousTurnEvent.timestamp,
    );
    const capped = Math.min(gapMilliseconds, DURATION_GAP_CAP_MILLISECONDS);
    if (capped > 0) {
      addActivitySpan(
        accumulator,
        'engagedMilliseconds',
        accumulator.previousTurnEvent.timestamp,
        capped,
      );
    }
  }
  if (accumulator.previousAssistant !== null) {
    const gapMilliseconds = Math.max(
      0,
      event.timestamp - accumulator.previousAssistant.timestamp,
    );
    const capped = Math.min(gapMilliseconds, ACTIVE_GAP_CAP_MILLISECONDS);
    if (capped > 0) {
      addActivitySpan(
        accumulator,
        'activeMilliseconds',
        accumulator.previousAssistant.timestamp,
        capped,
      );
    }
  }
  if (accumulator.previousTurnEvent !== null) {
    accumulator.previousTurnEvent = event;
    accumulator.previousAssistant = event;
  }
}

export function sessionAccumulatorIsOrdered(accumulator) {
  return accumulator.ordered;
}

export function finalizeSessionAccumulator(
  accumulator,
  sessionId,
  sessionSalt,
  projectOverride,
) {
  if (typeof sessionSalt !== 'string' || sessionSalt.length < 32) {
    throw new Error('A 32-character installation session salt is required');
  }
  if (accumulator.first === null || accumulator.last === null) return null;
  if (!accumulator.ordered) {
    throw new TypeError('Session accumulator received out-of-order events');
  }

  const activityHours = [...accumulator.activityByHour.values()]
    .map(({ activeMilliseconds, engagedMilliseconds, ...hour }) => ({
      ...hour,
      // Round once per calendar hour. Rounding every individual event gap
      // can accumulate fractional milliseconds past the 3,600-second API
      // limit even though the real span never exceeds one hour.
      activeSeconds: Math.min(3_600, Math.round(activeMilliseconds / 1000)),
      engagedSeconds: Math.min(3_600, Math.round(engagedMilliseconds / 1000)),
    }))
    .sort((left, right) => left.hourStart.localeCompare(right.hourStart));
  return {
    source: accumulator.first.source,
    ...(accumulator.latestAgentVersion
      ? { agentVersion: accumulator.latestAgentVersion }
      : {}),
    project: projectOverride || accumulator.first.project || 'unknown',
    sessionHash: createHmac('sha256', sessionSalt).update(sessionId).digest('hex'),
    firstMessageAt: accumulator.first.timestamp.toISOString(),
    lastMessageAt: accumulator.last.timestamp.toISOString(),
    durationSeconds: activityHours.reduce((sum, hour) => sum + hour.engagedSeconds, 0),
    activeSeconds: activityHours.reduce((sum, hour) => sum + hour.activeSeconds, 0),
    messageCount: activityHours.reduce((sum, hour) => sum + hour.messageCount, 0),
    userMessageCount: accumulator.userMessageCount,
    userPromptHours: accumulator.userPromptHours,
    activityHours,
  };
}

export function extractSessions(events, sessionSalt) {
  if (typeof sessionSalt !== 'string' || sessionSalt.length < 32) {
    throw new Error('A 32-character installation session salt is required');
  }
  const groups = new Map();
  for (const event of events) {
    if (!groups.has(event.sessionId)) groups.set(event.sessionId, []);
    groups.get(event.sessionId).push(event);
  }

  const sessions = [];
  for (const [sessionId, sessionEvents] of groups) {
    sessionEvents.sort((left, right) => left.timestamp - right.timestamp);
    const accumulator = createSessionAccumulator();
    for (const event of sessionEvents) accumulateSessionEvent(accumulator, event);
    const session = finalizeSessionAccumulator(accumulator, sessionId, sessionSalt);
    if (session) sessions.push(session);
  }
  return sessions;
}
