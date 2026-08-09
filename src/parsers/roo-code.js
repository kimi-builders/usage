import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';

const EXTENSION_ID = 'rooveterinaryinc.roo-cline';
const HOSTS = ['Code', 'Cursor', 'Windsurf', 'VSCodium', 'Code - Insiders', 'Trae', 'Trae CN'];

function defaultRoots() {
  let base;
  if (process.platform === 'darwin') base = join(homedir(), 'Library', 'Application Support');
  else if (process.platform === 'win32') {
    base = process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
  } else base = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return HOSTS.map((host) => join(base, host, 'User', 'globalStorage', EXTENSION_ID));
}

export function roots() {
  const override = process.env.KBU_USAGE_ROO_DIRS;
  const candidates = override !== undefined
    ? override.split(delimiter).map((path) => path.trim()).filter(Boolean)
    : defaultRoots();
  return candidates.filter((candidate) => {
    try { return statSync(candidate).isDirectory(); } catch { return false; }
  });
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function projectFromPath(path) {
  if (typeof path !== 'string' || !path) return 'unknown';
  return basename(path.replace(/[\\/]+$/, '')) || 'unknown';
}

function historyItems(root) {
  const tasksDir = join(root, 'tasks');
  const index = readJson(join(tasksDir, '_index.json'));
  if (Array.isArray(index?.entries)) return index.entries;
  const items = [];
  let entries;
  try { entries = readdirSync(tasksDir, { withFileTypes: true }); } catch { return items; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const item = readJson(join(tasksDir, entry.name, 'history_item.json'));
    if (item && typeof item === 'object') items.push(item);
  }
  return items;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export async function parse({ sessionSalt } = {}) {
  const scanRoots = roots();
  if (scanRoots.length === 0) return null;
  const entries = [];
  const events = [];
  for (const root of scanRoots) {
    for (const item of historyItems(root)) {
      if (!item || typeof item !== 'object' || !item.id) continue;
      const sessionId = String(item.id);
      const project = projectFromPath(item.workspace);
      const fallbackModel = String(item.apiConfigName || '').trim() || 'roo-unknown';
      const messages = readJson(join(root, 'tasks', sessionId, 'ui_messages.json'));
      if (!Array.isArray(messages)) continue;
      for (const message of messages) {
        const timestamp = new Date(Number(message?.ts));
        if (!message || Number.isNaN(timestamp.getTime())) continue;
        if (message.type === 'say' && message.say === 'api_req_started') {
          let info;
          try { info = JSON.parse(message.text); } catch { continue; }
          const inputTokens = count(info.tokensIn);
          const outputTokens = count(info.tokensOut);
          const cacheWriteInputTokens = count(info.cacheWrites);
          const cacheReadInputTokens = count(info.cacheReads);
          if (inputTokens + outputTokens + cacheWriteInputTokens + cacheReadInputTokens === 0) continue;
          entries.push({
            source: 'roo-code',
            model: String(info.model || '').trim() || fallbackModel,
            project,
            timestamp,
            inputTokens,
            cacheWriteInputTokens,
            cacheReadInputTokens,
            outputTokens,
            reasoningOutputTokens: 0,
            requestCount: 1,
          });
          events.push({ sessionId, source: 'roo-code', project, timestamp, role: 'assistant' });
        } else if (
          message.type === 'ask'
          || (message.type === 'say' && message.say === 'user_feedback')
        ) {
          events.push({ sessionId, source: 'roo-code', project, timestamp, role: 'user' });
        }
      }
    }
  }
  return { buckets: aggregateToBuckets(entries), sessions: extractSessions(events, sessionSalt) };
}
