import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { configuredExtraRoots, expandLocalPath } from '../extra-roots.js';
import { aggregateToBuckets, extractSessions } from './index.js';

function defaultSessionsDir() {
  const override = process.env.KBU_USAGE_GROK_SESSIONS?.trim();
  if (override) return expandLocalPath(override);
  const home = expandLocalPath(process.env.GROK_HOME?.trim() || join(homedir(), '.grok'));
  return join(home, 'sessions');
}

function asSessionsDir(path) {
  return basename(path) === 'sessions' ? path : join(path, 'sessions');
}

export function roots({ sourceOptions } = {}) {
  return [...new Set([
    defaultSessionsDir(),
    ...configuredExtraRoots(sourceOptions, 'grok').map(asSessionsDir),
  ])].filter((path) => {
    try { return existsSync(path) && statSync(path).isDirectory(); } catch { return false; }
  });
}

function projectName(value) {
  return basename(String(value || '').replace(/[\\/]+$/, '')) || 'unknown';
}

function readJson(path, strict = false) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { if (strict) throw error; return null; }
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number'
    ? new Date(value < 1e12 ? value * 1000 : value)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function pushUsage(entries, { model, project, timestamp, usage }) {
  if (!timestamp || !usage || typeof usage !== 'object') return;
  const cacheReadInputTokens = count(usage.cachedReadTokens);
  const reasoningOutputTokens = count(usage.reasoningTokens);
  const inputTokens = Math.max(0, count(usage.inputTokens) - cacheReadInputTokens);
  const outputTokens = Math.max(0, count(usage.outputTokens) - reasoningOutputTokens);
  if (inputTokens + cacheReadInputTokens + outputTokens + reasoningOutputTokens === 0) return;
  entries.push({
    source: 'grok', model: model || 'unknown', project, timestamp,
    inputTokens, cacheWriteInputTokens: 0, cacheReadInputTokens,
    outputTokens, reasoningOutputTokens,
    requestCount: Math.max(1, Math.round(count(usage.modelCalls))),
  });
}

function emitTurnUsage(entries, values) {
  const modelUsage = values.usage?.modelUsage;
  if (modelUsage && typeof modelUsage === 'object' && Object.keys(modelUsage).length) {
    for (const [model, usage] of Object.entries(modelUsage)) {
      pushUsage(entries, { ...values, model, usage });
    }
    return;
  }
  pushUsage(entries, values);
}

async function forEachJsonl(path, callback) {
  if (!existsSync(path)) return;
  const input = createReadStream(path, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try { callback(JSON.parse(line)); } catch { /* isolate malformed/appending lines */ }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

function projectFromGroup(group, path) {
  try {
    const cwd = readFileSync(join(path, '.cwd'), 'utf8').trim();
    if (cwd) return projectName(cwd);
  } catch { /* optional sidecar */ }
  try {
    const decoded = decodeURIComponent(group);
    if (decoded.includes('/') || decoded.includes('\\')) return projectName(decoded);
  } catch { /* plain group name */ }
  return group || 'unknown';
}

function candidates(sessionsDir) {
  const result = [];
  for (const group of readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    const groupPath = join(sessionsDir, group.name);
    const fallbackProject = projectFromGroup(group.name, groupPath);
    for (const child of readdirSync(groupPath, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const sessionPath = join(groupPath, child.name);
      if (!existsSync(join(sessionPath, 'summary.json'))
        && !existsSync(join(sessionPath, 'updates.jsonl'))) continue;
      const score = ['updates.jsonl', 'events.jsonl', 'summary.json'].map((file) => {
        try { return statSync(join(sessionPath, file)).size; } catch { return 0; }
      });
      result.push({ sessionId: child.name, sessionPath, fallbackProject, score });
    }
  }
  return result;
}

function moreComplete(left, right) {
  if (!right) return true;
  for (let index = 0; index < left.score.length; index += 1) {
    if (left.score[index] !== right.score[index]) return left.score[index] > right.score[index];
  }
  return left.sessionPath < right.sessionPath;
}

export async function parse({ sessionSalt, sourceOptions } = {}) {
  const scanRoots = roots({ sourceOptions });
  if (!scanRoots.length) return null;
  const winners = new Map();
  for (const root of scanRoots) {
    for (const candidate of candidates(root)) {
      if (moreComplete(candidate, winners.get(candidate.sessionId))) {
        winners.set(candidate.sessionId, candidate);
      }
    }
  }
  const entries = [];
  const events = [];
  for (const { sessionId, sessionPath, fallbackProject } of winners.values()) {
    const summary = readJson(join(sessionPath, 'summary.json')) || {};
    const projectPath = summary.info?.cwd || summary.git_root_dir;
    const project = projectPath ? projectName(projectPath) : fallbackProject;
    const fallbackModel = summary.current_model_id || 'unknown';
    let sawMessages = false;
    await forEachJsonl(join(sessionPath, 'updates.jsonl'), (record) => {
      const update = record?.params?.update;
      if (!update || typeof update !== 'object') return;
      const timestamp = toDate(record.timestamp);
      if (update.sessionUpdate === 'turn_completed') {
        emitTurnUsage(entries, { usage: update.usage, model: fallbackModel, project, timestamp });
      }
      if (!timestamp) return;
      if (update.sessionUpdate === 'user_message_chunk') {
        sawMessages = true;
        events.push({ sessionId, source: 'grok', project, timestamp, role: 'user' });
      } else if (['agent_message_chunk', 'turn_completed'].includes(update.sessionUpdate)) {
        sawMessages = true;
        events.push({ sessionId, source: 'grok', project, timestamp, role: 'assistant' });
      }
    });
    if (!sawMessages) {
      await forEachJsonl(join(sessionPath, 'events.jsonl'), (record) => {
        const timestamp = toDate(record.ts || record.timestamp);
        if (!timestamp) return;
        if (record.type === 'turn_started') events.push({ sessionId, source: 'grok', project, timestamp, role: 'user' });
        else if (['turn_ended', 'first_token'].includes(record.type)) {
          events.push({ sessionId, source: 'grok', project, timestamp, role: 'assistant' });
        }
      });
    }
    if (!events.some((event) => event.sessionId === sessionId)) {
      const first = toDate(summary.created_at || summary.info?.created_at);
      const last = toDate(summary.updated_at || summary.last_active_at);
      if (first) events.push({ sessionId, source: 'grok', project, timestamp: first, role: 'user' });
      if (last && last.getTime() !== first?.getTime()) {
        events.push({ sessionId, source: 'grok', project, timestamp: last, role: 'assistant' });
      }
    }
  }
  return { buckets: aggregateToBuckets(entries), sessions: extractSessions(events, sessionSalt) };
}
