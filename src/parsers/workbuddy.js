import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join, relative, sep } from 'node:path';
import { workbuddyProjectsRoots } from '../workbuddy-roots.js';
import { aggregateToBuckets, extractSessions } from './index.js';

const SOURCE = 'workbuddy';
const MAX_WARNINGS = 20;

function warn(context, message) {
  context.incomplete = true;
  if (context.warnings.length < MAX_WARNINGS && !context.warnings.includes(message)) {
    context.warnings.push(message);
  }
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function date(value) {
  const normalized = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
  const result = new Date(normalized);
  return Number.isNaN(result.getTime()) ? null : result;
}

function projectFromPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
    .filter((part) => !/^[A-Za-z]:$/.test(part)).at(-1) || null;
}

function projectFromFile(filePath, projectsRoot) {
  const first = relative(projectsRoot, filePath).split(sep).filter(Boolean)[0];
  return first ? basename(first) : 'unknown';
}

function jsonlFiles(dir, context) {
  let children;
  try {
    children = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(context, 'WorkBuddy: cannot read a data directory');
    return [];
  }
  return children.flatMap((child) => {
    const filePath = join(dir, child.name);
    if (child.isDirectory()) return jsonlFiles(filePath, context);
    return child.isFile() && child.name.endsWith('.jsonl') ? [filePath] : [];
  });
}

async function readJsonl(filePath, size, onRecord, context) {
  if (size <= 0) return;
  const stream = createReadStream(filePath, { encoding: 'utf8', start: 0, end: size - 1 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record && typeof record === 'object') onRecord(record);
    }
  } catch {
    warn(context, 'WorkBuddy: cannot read a session file');
  } finally {
    lines.close();
    stream.destroy();
  }
}

function recordId(record) {
  if (!['string', 'number'].includes(typeof record.id)) return null;
  return String(record.id).trim() || null;
}

function role(record) {
  const value = record.role ?? record.message?.role;
  if (value === 'user') return 'user';
  if (value === 'assistant' || value === 'assistant_message') return 'assistant';
  return null;
}

function completedAssistant(record) {
  if (record.type !== 'message' || role(record) !== 'assistant') return false;
  return ['completed', 'complete', 'success'].includes(String(
    record.status ?? record.message?.status ?? record.state ?? record.message?.state ?? '',
  ).toLowerCase());
}

function usageRecord(record) {
  return completedAssistant(record)
    || (record.type === 'function_call' && record.providerData && typeof record.providerData === 'object');
}

function firstDetail(details, ...keys) {
  for (const detail of Array.isArray(details) ? details : [details]) {
    if (!detail || typeof detail !== 'object') continue;
    for (const key of keys) if (detail[key] != null) return count(detail[key]);
  }
  return 0;
}

function usage(record) {
  const providerData = record.providerData && typeof record.providerData === 'object'
    ? record.providerData : {};
  const primary = providerData.usage && typeof providerData.usage === 'object'
    ? providerData.usage
    : record.message?.usage && typeof record.message.usage === 'object'
      ? record.message.usage : null;
  const raw = providerData.rawUsage && typeof providerData.rawUsage === 'object'
    ? providerData.rawUsage : null;
  if (!primary && !raw) return null;

  const cacheReadInputTokens = firstDetail(
    primary?.input_details ?? primary?.inputDetails ?? primary?.inputTokensDetails
      ?? raw?.prompt_tokens_details,
    'cached_tokens', 'cachedTokens',
  ) || count(primary?.cachedInputTokens ?? primary?.cache_read_input_tokens
    ?? primary?.cacheReadInputTokens ?? raw?.prompt_cache_hit_tokens
    ?? raw?.cache_read_input_tokens);
  const cacheWriteInputTokens = count(primary?.cacheWriteInputTokens
    ?? primary?.cache_creation_input_tokens ?? primary?.cacheWriteTokens
    ?? raw?.prompt_cache_write_tokens ?? raw?.cache_creation_input_tokens);
  const reasoningOutputTokens = firstDetail(
    primary?.output_details ?? primary?.outputDetails ?? primary?.outputTokensDetails
      ?? raw?.completion_tokens_details,
    'reasoning_tokens', 'reasoningTokens',
  ) || count(primary?.reasoningOutputTokens ?? primary?.completion_thinking_tokens
    ?? primary?.reasoning_tokens ?? primary?.reasoningTokens
    ?? raw?.completion_thinking_tokens);
  const inclusiveInput = count(primary?.inputTokens ?? primary?.input_tokens ?? raw?.prompt_tokens);
  const inclusiveOutput = count(primary?.outputTokens ?? primary?.output_tokens ?? raw?.completion_tokens);
  const cacheMiss = count(raw?.prompt_cache_miss_tokens);
  const inputTokens = cacheMiss > 0
    ? cacheMiss
    : Math.max(0, inclusiveInput - cacheReadInputTokens - cacheWriteInputTokens);
  const outputTokens = Math.max(0, inclusiveOutput - reasoningOutputTokens);
  const score = inputTokens + cacheWriteInputTokens + cacheReadInputTokens
    + outputTokens + reasoningOutputTokens;
  return score > 0 ? {
    inputTokens, cacheWriteInputTokens, cacheReadInputTokens,
    outputTokens, reasoningOutputTokens, score,
  } : null;
}

function model(record) {
  const provider = record.providerData && typeof record.providerData === 'object'
    ? record.providerData : {};
  return [provider.requestModelId, record.requestModelName, provider.requestModelName, provider.model]
    .find((value) => typeof value === 'string' && value.trim())?.trim() || 'unknown';
}

function timestamp(record) {
  return date(record.completedAt ?? record.completed_at ?? record.timestamp
    ?? record.createdAt ?? record.created_at ?? record.message?.createdAt);
}

export function roots() {
  return workbuddyProjectsRoots();
}

export async function parse({ sessionSalt } = {}) {
  const scanRoots = roots();
  if (!scanRoots.length) return null;
  const context = { incomplete: false, warnings: [] };
  const entriesById = new Map();
  const eventsById = new Map();

  for (const projectsRoot of scanRoots) {
    for (const filePath of jsonlFiles(projectsRoot, context)) {
      let size;
      try { size = statSync(filePath).size; } catch {
        warn(context, 'WorkBuddy: cannot inspect a session file');
        continue;
      }
      const fallbackSessionId = basename(filePath, '.jsonl');
      let project = projectFromFile(filePath, projectsRoot);
      const fileEntries = [];
      const fileEvents = [];
      await readJsonl(filePath, size, (record) => {
        project = projectFromPath(record.cwd) || project;
        const at = timestamp(record);
        const id = recordId(record);
        const explicitSession = record.sessionId ?? record.session_id;
        const sessionId = explicitSession == null || String(explicitSession).trim() === ''
          ? fallbackSessionId : String(explicitSession);
        const parsedUsage = usageRecord(record) ? usage(record) : null;
        const eventRole = role(record) === 'user' ? 'user'
          : completedAssistant(record) || (record.type === 'function_call' && parsedUsage)
            ? 'assistant' : null;
        if (at && eventRole) fileEvents.push({ id, sessionId, timestamp: at, role: eventRole });
        if (!id || !at || !parsedUsage) return;
        const provider = record.providerData && typeof record.providerData === 'object'
          ? record.providerData : {};
        fileEntries.push({
          key: `${sessionId}:${id}`,
          score: parsedUsage.score,
          entry: {
            source: SOURCE,
            model: model(record),
            ...(typeof provider.provider === 'string' && provider.provider.trim()
              ? { modelProvider: provider.provider.trim() } : {}),
            timestamp: at,
            ...parsedUsage,
            requestCount: 1,
          },
        });
      }, context);

      for (const candidate of fileEntries) {
        candidate.entry.project = project;
        const current = entriesById.get(candidate.key);
        if (!current || candidate.score > current.score) entriesById.set(candidate.key, candidate);
      }
      for (const candidate of fileEvents) {
        const event = { sessionId: candidate.sessionId, source: SOURCE, project,
          timestamp: candidate.timestamp, role: candidate.role };
        const key = candidate.id
          ? `${candidate.sessionId}:${candidate.id}:${candidate.role}`
          : `${candidate.sessionId}:${candidate.role}:${candidate.timestamp.toISOString()}`;
        eventsById.set(key, event);
      }
    }
  }

  const events = [...eventsById.values()];
  const sessionsWithUsers = new Set(events.filter((event) => event.role === 'user')
    .map((event) => event.sessionId));
  return {
    buckets: aggregateToBuckets([...entriesById.values()].map(({ entry }) => entry)),
    sessions: extractSessions(events.filter((event) => sessionsWithUsers.has(event.sessionId)), sessionSalt),
    ...(context.incomplete ? { skipped: true } : {}),
    ...(context.warnings.length ? { warnings: context.warnings } : {}),
  };
}
