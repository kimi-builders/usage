import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { jsonlRecords } from './jsonl-records.js';
import { aggregateToBuckets, extractSessions } from './index.js';
import { piProjectFromCwd } from './pi-session-jsonl.js';

export function roots({ environment = process.env, home = homedir() } = {}) {
  const override = environment.KBU_USAGE_STEPCODE_SESSIONS;
  const official = environment.STEP_CODING_AGENT_SESSION_DIR?.trim();
  const paths = override !== undefined ? override.split(delimiter)
    : [official || join(environment.STEP_CODING_AGENT_DIR?.trim()
      || join(home, environment.STEPCODE_CONFIG_DIR?.trim() || '.stepcode', 'agent'), 'sessions')];
  const expand = path => path === '~' ? home : /^~[/\\]/.test(path) ? join(home, path.slice(2)) : path;
  // Explicit locations never fall back to another installation's logs.
  // The KBU override additionally allows an empty string to disable discovery.
  return [...new Set(paths.map(path => path.trim()).filter(Boolean).map(path => resolve(expand(path))))].filter(path => {
    try { return existsSync(path) && statSync(path).isDirectory(); } catch { return false; }
  });
}

export async function parse({ sessionSalt } = {}) {
  const scanRoots = roots();
  if (!scanRoots.length) return null;
  const warnings = []; let incomplete = false; let count = 0;
  const warn = message => { incomplete = true; if (warnings.length < 20) warnings.push(`stepcode: ${message}`); };
  const files = [];
  function visit(dir, depth) {
    if (depth > 32 || count >= 10_000) { warn('session discovery budget exceeded'); return; }
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { warn('cannot read a session directory'); return; }
    for (const item of entries) {
      if (count >= 10_000) { warn('session discovery budget exceeded'); return; }
      if (item.isDirectory() && item.name !== 'tool-output') visit(join(dir, item.name), depth + 1);
      else if (item.isFile() && item.name.endsWith('.jsonl')) { count++; files.push(join(dir, item.name)); }
    }
  }
  for (const root of scanRoots) visit(root, 0);
  const usageByIdentity = new Map(); const eventByIdentity = new Map();
  let records = 0; let exhausted = false;
  for (const file of files.sort()) {
    let sessionId = ''; let project = 'unknown'; let currentModel = 'unknown'; let currentProvider = ''; let forked = false;
    const usage = []; const events = []; const provenance = new Map();
    for await (const record of jsonlRecords(file, warn)) {
      records++;
      if (records > 200_000) { warn('session record budget exceeded'); exhausted = true; break; }
      if (record.type === 'session') {
        sessionId = typeof record.id === 'string' ? record.id : '';
        project = piProjectFromCwd(record.cwd);
        forked = Boolean(record.parentSession || record.parentSessionId);
        if (forked) warn('forked session requires provenance verification');
        continue;
      }
      if (!sessionId) { warn('session header is missing'); continue; }
      if (record.type === 'model_change') { currentModel = record.modelId || record.model || currentModel; currentProvider = record.provider || currentProvider; continue; }
      if (record.type === 'custom' && record.customType === 'step.usage_provenance') {
        if (record.data?.usageEntryId && record.data?.originSessionId) provenance.set(String(record.data.usageEntryId), String(record.data.originSessionId));
        continue;
      }
      if (['custom', 'custom_message'].includes(record.type) && record.customType === 'step-auto-clm-usage') { warn('unsupported incremental compression usage'); continue; }
      const message = record.message;
      const role = record.type === 'message' ? message?.role : null;
      const isUsage = (role === 'assistant' || role === 'toolResult') ? message?.usage
        : ['compaction', 'branch_summary'].includes(record.type) ? record.usage : null;
      const rawTime = record.timestamp || message?.timestamp;
      const timestamp = rawTime == null ? null : new Date(rawTime);
      if ((isUsage || ['user', 'assistant', 'toolResult'].includes(role)) && (!timestamp || !Number.isFinite(timestamp.getTime()))) {
        warn('usage or activity has no valid timestamp'); continue;
      }
      if (['user', 'assistant', 'toolResult'].includes(role)) events.push({ id: record.id, timestamp, role: role === 'user' ? 'user' : 'assistant' });
      if (!isUsage) continue;
      const fields = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
      if (fields.some(key => isUsage[key] != null && (!Number.isSafeInteger(isUsage[key]) || isUsage[key] < 0))
        || (isUsage.reasoning || 0) > (isUsage.output || 0)) { warn('invalid token counters'); continue; }
      const [inputTokens, output, cacheReadInputTokens, cacheWriteInputTokens, reasoningOutputTokens] = fields.map(key => isUsage[key] || 0);
      if (!Number.isSafeInteger(inputTokens + output + cacheReadInputTokens + cacheWriteInputTokens)) { warn('token counters exceed safe range'); continue; }
      if (!(inputTokens + output + cacheReadInputTokens + cacheWriteInputTokens)) continue;
      if (!record.id) { warn('usage entry lacks a stable identity'); continue; }
      usage.push({ id: String(record.id), entry: { source: 'stepcode', project, timestamp,
        model: message?.model || currentModel, ...(message?.provider || currentProvider ? { modelProvider: message?.provider || currentProvider } : {}),
        inputTokens, outputTokens: output - reasoningOutputTokens, cacheReadInputTokens, cacheWriteInputTokens,
        reasoningOutputTokens, requestCount: 1 } });
    }
    for (const { id, entry } of usage) {
      if (forked && !provenance.has(id)) continue;
      const key = `${provenance.get(id) || sessionId}:${id}`;
      const previous = usageByIdentity.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) { warn('conflicting copied usage entry'); continue; }
      usageByIdentity.set(key, entry);
    }
    for (const event of events) {
      if (!event.id) { warn('activity entry lacks a stable identity'); continue; }
      if (forked && !provenance.has(String(event.id))) continue;
      const origin = provenance.get(String(event.id)) || sessionId;
      const key = `${origin}:${event.id}`;
      if (!eventByIdentity.has(key)) eventByIdentity.set(key, { sessionId: origin, source: 'stepcode', project, timestamp: event.timestamp, role: event.role });
    }
    if (exhausted) break;
  }
  return { buckets: aggregateToBuckets([...usageByIdentity.values()]),
    sessions: extractSessions([...eventByIdentity.values()], sessionSalt),
    ...(incomplete ? { skipped: true } : {}), ...(warnings.length ? { warnings } : {}) };
}
