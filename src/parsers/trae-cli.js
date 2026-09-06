import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { configuredExtraRoots } from '../extra-roots.js';
import { aggregateToBuckets, extractSessions } from './index.js';

const PRIMARY = 'model.stream.eino';
const FAILOVER = 'model.generate';
const FALLBACKS = ['model.real_call', 'model.call'];

function defaultSessionsDir() {
  const override = process.env.KBU_USAGE_TRAE_CLI_SESSIONS?.trim();
  if (override) return override;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'trae-cli', 'sessions');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local'), 'trae-cli', 'cache', 'sessions');
  }
  return join(process.env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache'), 'trae-cli', 'sessions');
}

export function roots({ sourceOptions } = {}) {
  return [...new Set([
    defaultSessionsDir(),
    ...configuredExtraRoots(sourceOptions, 'trae-cli'),
  ])].filter((path) => {
    try { return existsSync(path) && statSync(path).isDirectory(); } catch { return false; }
  });
}

function projectName(value) {
  return basename(String(value || '').replace(/[\\/]+$/, '')) || 'unknown';
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function tags(values) {
  const result = {};
  for (const item of Array.isArray(values) ? values : []) {
    if (item && typeof item === 'object' && item.key) result[item.key] = item.value;
  }
  return result;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageFrom(values) {
  const cacheReadInputTokens = count(values['usage.cache_read_tokens']);
  const reasoningOutputTokens = count(values['usage.reasoning_tokens']);
  // Trae's total is input + output while cache/reasoning are reported as
  // subsets of those counters. Normalize them into the protocol's mutually
  // exclusive fields before aggregation.
  return {
    inputTokens: Math.max(0, count(values['usage.input_tokens']) - cacheReadInputTokens),
    outputTokens: Math.max(0, count(values['usage.output_tokens']) - reasoningOutputTokens),
    cacheReadInputTokens,
    reasoningOutputTokens,
  };
}

function hasUsage(usage) {
  return Object.values(usage).some((value) => value > 0);
}

export function selectTraeUsageSpans(spans) {
  const eligible = spans.filter((span) => hasUsage(span.usage));
  const primary = eligible.filter((span) => span.category === PRIMARY);
  const failovers = eligible.filter((span) => span.category === FAILOVER);
  if (primary.length || failovers.length) return [...primary, ...failovers];
  for (const category of FALLBACKS) {
    const matches = eligible.filter((span) => span.category === category);
    if (matches.length) return matches;
  }
  return eligible;
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

export async function parse({ sessionSalt, sourceOptions } = {}) {
  const scanRoots = roots({ sourceOptions });
  if (!scanRoots.length) return null;
  const entries = [];
  const events = [];
  for (const sessionsDir of scanRoots) {
    let children;
    try { children = readdirSync(sessionsDir, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const sessionId = child.name;
      const sessionPath = join(sessionsDir, sessionId);
      const metadata = readJson(join(sessionPath, 'session.json'))?.metadata || {};
      const project = projectName(metadata.cwd);
      const fallbackModel = metadata.model_name || 'trae-unknown';
      const spans = [];
      await forEachJsonl(join(sessionPath, 'traces.jsonl'), (line) => {
        const tagMap = tags(line.tags);
        const usage = usageFrom(tagMap);
        const startTime = Number(line.startTime);
        if (!hasUsage(usage) || !Number.isFinite(startTime) || startTime <= 0) return;
        spans.push({
          category: String(tagMap['span.category'] || ''),
          model: tagMap['model.name'] || tagMap['semantic.name'] || fallbackModel,
          startTime,
          usage,
        });
      });
      for (const span of selectTraeUsageSpans(spans)) {
        const timestamp = new Date(span.startTime / 1000);
        if (Number.isNaN(timestamp.getTime())) continue;
        entries.push({
          source: 'trae-cli', model: span.model, project, timestamp, ...span.usage, requestCount: 1,
        });
      }
      await forEachJsonl(join(sessionPath, 'events.jsonl'), (line) => {
        const timestamp = new Date(line.created_at || 0);
        if (Number.isNaN(timestamp.getTime())) return;
        if (line.agent_start) events.push({ sessionId, source: 'trae-cli', project, timestamp, role: 'user' });
        else if (line.agent_end || line.tool_call || line.message?.message?.role === 'assistant') {
          events.push({ sessionId, source: 'trae-cli', project, timestamp, role: 'assistant' });
        }
      });
    }
  }
  return { buckets: aggregateToBuckets(entries), sessions: extractSessions(events, sessionSalt) };
}
