import { createHmac } from 'node:crypto';
import { parse as parseKimiCode, roots as kimiCodeRoots } from './kimi-code.js';
import { parse as parseClaudeCode, roots as claudeCodeRoots } from './claude-code.js';
import { parse as parseCodex, roots as codexRoots } from './codex.js';
import { parse as parseOpenCode, roots as openCodeRoots } from './opencode.js';
import { parse as parseGeminiCli, roots as geminiCliRoots } from './gemini-cli.js';
import { parse as parseAntigravity, roots as antigravityRoots } from './antigravity.js';

// Multi-source registry. Tiers: core (always on), stable (on), beta (opt-in,
// not yet collected), disabled (kept for reference, never collected).
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
];

export function enabledSources() {
  return sourceRegistry.filter((source) => source.tier === 'core' || source.tier === 'stable');
}

// Back-compat id → parse map, built from the registry.
export const parsers = Object.fromEntries(sourceRegistry.map((source) => [source.id, source.parse]));

export function roundToHalfHour(date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() < 30 ? 0 : 30, 0, 0);
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
    const project = String(entry.project || 'unknown').slice(0, 120);
    const bucketStart = roundToHalfHour(entry.timestamp).toISOString();
    const key = `${entry.source}|${model}|${project}|${bucketStart}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        source: entry.source,
        model,
        project,
        bucketStart,
        inputTokens: 0,
        cacheWriteInputTokens: 0,
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
    bucket.cacheReadInputTokens += entry.cacheReadInputTokens || 0;
    bucket.outputTokens += entry.outputTokens || 0;
    bucket.reasoningOutputTokens += entry.reasoningOutputTokens || 0;
    bucket.requestCount += entry.requestCount || 1;
  }
  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    inputTokens: tokenCount(bucket.inputTokens),
    cacheWriteInputTokens: tokenCount(bucket.cacheWriteInputTokens),
    cacheReadInputTokens: tokenCount(bucket.cacheReadInputTokens),
    outputTokens: tokenCount(bucket.outputTokens),
    reasoningOutputTokens: tokenCount(bucket.reasoningOutputTokens),
    requestCount: tokenCount(bucket.requestCount),
  }));
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
    const first = sessionEvents[0];
    const last = sessionEvents[sessionEvents.length - 1];
    let activeSeconds = 0;
    let turnStart = null;
    let turnEnd = null;
    let waitingForFirstResponse = false;
    for (const event of sessionEvents) {
      if (event.role === 'user') {
        if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
          activeSeconds += Math.round((turnEnd - turnStart) / 1000);
        }
        turnStart = null;
        turnEnd = null;
        waitingForFirstResponse = true;
      } else if (waitingForFirstResponse) {
        turnStart = event.timestamp;
        turnEnd = event.timestamp;
        waitingForFirstResponse = false;
      } else if (turnStart !== null) {
        turnEnd = event.timestamp;
      }
    }
    if (turnStart !== null && turnEnd !== null && turnEnd > turnStart) {
      activeSeconds += Math.round((turnEnd - turnStart) / 1000);
    }

    const userPromptHours = new Array(24).fill(0);
    let userMessageCount = 0;
    for (const event of sessionEvents) {
      if (event.role === 'user') {
        userMessageCount += 1;
        userPromptHours[event.timestamp.getUTCHours()] += 1;
      }
    }
    sessions.push({
      source: first.source,
      project: first.project || 'unknown',
      sessionHash: createHmac('sha256', sessionSalt).update(sessionId).digest('hex'),
      firstMessageAt: first.timestamp.toISOString(),
      lastMessageAt: last.timestamp.toISOString(),
      durationSeconds: Math.max(0, Math.round((last.timestamp - first.timestamp) / 1000)),
      activeSeconds,
      messageCount: sessionEvents.length,
      userMessageCount,
      userPromptHours,
    });
  }
  return sessions;
}

