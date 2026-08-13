import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { aggregateToBuckets, extractSessions } from './index.js';

const MAX_WARNINGS = 20;

function warn(context, message) {
  context.incomplete = true;
  if (context.warnings.length < MAX_WARNINGS) context.warnings.push(message);
}

function jsonlFiles(dir, context) {
  if (!existsSync(dir)) return [];
  let children;
  try {
    children = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    warn(context, `${context.source}: cannot read a session directory: ${error.message}`);
    return [];
  }
  return children.flatMap((child) => {
    const filePath = join(dir, child.name);
    if (child.isDirectory()) return jsonlFiles(filePath, context);
    return child.isFile() && child.name.endsWith('.jsonl') ? [filePath] : [];
  });
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function piProjectFromCwd(cwd) {
  if (typeof cwd !== 'string') return 'unknown';
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || 'unknown';
}

function projectFromPath(filePath, sessionsDir) {
  const first = relative(sessionsDir, filePath).split(/[\\/]/)[0];
  return first?.split('-').filter(Boolean).at(-1) || 'unknown';
}

export async function parsePiSessions({ source, roots, sessionSalt }) {
  const context = { source, warnings: [], incomplete: false };
  const entriesById = new Map();
  const eventsById = new Map();
  const anonymousEntries = [];
  const anonymousEvents = [];

  for (const sessionsDir of roots) {
    for (const filePath of jsonlFiles(sessionsDir, context)) {
      let content;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch (error) {
        warn(context, `${source}: cannot read a session file: ${error.message}`);
        continue;
      }

      let sessionId = basename(filePath, '.jsonl');
      let project = projectFromPath(filePath, sessionsDir);
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { continue; }

        if (record.type === 'session') {
          if (record.id) sessionId = String(record.id);
          if (record.cwd) project = piProjectFromCwd(record.cwd);
          continue;
        }
        if (record.type !== 'message' || !record.message) continue;

        const message = record.message;
        const timestamp = new Date(record.timestamp || message.timestamp || 0);
        if (Number.isNaN(timestamp.getTime())) continue;
        const recordId = record.id ? `${sessionId}:${record.id}` : null;
        if (['user', 'assistant', 'toolResult'].includes(message.role)) {
          const event = {
            sessionId,
            source,
            project,
            timestamp,
            role: message.role === 'user' ? 'user' : 'assistant',
          };
          if (recordId) eventsById.set(recordId, event);
          else anonymousEvents.push(event);
        }

        if (message.role !== 'assistant' || !message.usage) continue;
        const usage = message.usage;
        const inputTokens = count(usage.input);
        const cacheWriteInputTokens = count(usage.cacheWrite);
        const cacheReadInputTokens = count(usage.cacheRead);
        const reasoningOutputTokens = count(usage.reasoningTokens);
        // Pi-compatible stores include reasoning in usage.output.
        const outputTokens = Math.max(0, count(usage.output) - reasoningOutputTokens);
        const score = inputTokens + cacheWriteInputTokens + cacheReadInputTokens
          + outputTokens + reasoningOutputTokens;
        if (score === 0) continue;
        const entry = {
          source,
          model: message.model || message.modelId || record.model || record.modelId || 'unknown',
          ...(message.provider ? { modelProvider: String(message.provider) } : {}),
          project,
          timestamp,
          inputTokens,
          cacheWriteInputTokens,
          cacheReadInputTokens,
          outputTokens,
          reasoningOutputTokens,
          requestCount: 1,
        };
        if (recordId) {
          const current = entriesById.get(recordId);
          if (!current || score > current.score) entriesById.set(recordId, { score, entry });
        } else anonymousEntries.push(entry);
      }
    }
  }

  return {
    buckets: aggregateToBuckets([
      ...anonymousEntries,
      ...[...entriesById.values()].map(({ entry }) => entry),
    ]),
    sessions: extractSessions([...anonymousEvents, ...eventsById.values()], sessionSalt),
    ...(context.incomplete ? { skipped: true } : {}),
    ...(context.warnings.length ? { warnings: context.warnings } : {}),
  };
}
