import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';

function sessionStateDir() {
  return process.env.KBU_USAGE_COPILOT_DIR?.trim()
    || join(homedir(), '.copilot', 'session-state');
}

export function roots() {
  const root = sessionStateDir();
  return existsSync(root) ? [root] : [];
}

function eventFiles(baseDir) {
  const files = [];
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = join(baseDir, entry.name, 'events.jsonl');
    if (existsSync(filePath)) files.push({ filePath, sessionId: entry.name });
  }
  return files;
}

function projectFromContext(context) {
  const path = context?.gitRoot || context?.cwd;
  return typeof path === 'string' && path ? basename(path) || 'unknown' : 'unknown';
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export async function parse({ sessionSalt } = {}) {
  const [root] = roots();
  if (!root) return null;
  const entries = [];
  const events = [];
  const warnings = [];
  let files;
  try {
    files = eventFiles(root);
  } catch (error) {
    throw new Error(`Copilot CLI: cannot read ${root}: ${error.message}`);
  }
  for (const { filePath, sessionId } of files) {
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (error) {
      if (warnings.length < 20) warnings.push(`Copilot CLI: cannot read ${filePath}: ${error.message}`);
      continue;
    }
    let project = 'unknown';
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const timestamp = record.timestamp ? new Date(record.timestamp) : null;
      const validTimestamp = timestamp && !Number.isNaN(timestamp.getTime());
      if (record.type === 'session.start' || record.type === 'session.resume') {
        project = projectFromContext(record.data?.context);
      }
      if (validTimestamp && (record.type === 'user.message' || record.type === 'assistant.message')) {
        events.push({
          sessionId,
          source: 'copilot-cli',
          project,
          timestamp,
          role: record.type === 'user.message' ? 'user' : 'assistant',
        });
      }
      if (!validTimestamp || record.type !== 'session.shutdown') continue;
      for (const [model, metrics] of Object.entries(record.data?.modelMetrics || {})) {
        const usage = metrics?.usage;
        if (!usage) continue;
        const totalInput = count(usage.inputTokens);
        const cacheReadInputTokens = count(usage.cacheReadTokens);
        const cacheWriteInputTokens = count(usage.cacheWriteTokens);
        const outputTokens = count(usage.outputTokens);
        if (totalInput + cacheReadInputTokens + cacheWriteInputTokens + outputTokens === 0) continue;
        entries.push({
          source: 'copilot-cli',
          model,
          project,
          timestamp,
          inputTokens: Math.max(0, totalInput - cacheReadInputTokens - cacheWriteInputTokens),
          cacheWriteInputTokens,
          cacheReadInputTokens,
          outputTokens,
          reasoningOutputTokens: 0,
          requestCount: 1,
        });
      }
    }
  }
  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(events, sessionSalt),
    ...(warnings.length > 0 ? { skipped: true, warnings } : {}),
  };
}
