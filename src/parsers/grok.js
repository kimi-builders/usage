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

function hasUsageCounters(usage) {
  if (!usage || typeof usage !== 'object') return false;
  if (usage.modelUsage && Object.keys(usage.modelUsage).length) {
    return Object.values(usage.modelUsage).every(hasUsageCounters);
  }
  return ['inputTokens', 'outputTokens', 'cachedReadTokens', 'reasoningTokens', 'cacheCreationTokens']
    .some((key) => {
      const value = usage[key];
      return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
        && Number.isFinite(Number(value)) && Number(value) >= 0;
    });
}

// Grok 1.0 moved per-turn token accounting out of the ACP stream into a
// dedicated `<session>/usage.json` ledger — the CLI's own `grok usage` command
// is its documented reader. Older builds (0.2.x) wrote the same numbers into
// `updates.jsonl` `turn_completed.usage`; those sessions have no usage.json.
//
// The ledger holds token totals per turn but neither timestamps nor a model id,
// so callers pair its turns with the session's `turn_completed` events by order
// and fall back to the summary's model.
function readUsageLedger(sessionPath) {
  const ledger = readJson(join(sessionPath, 'usage.json'));
  if (!ledger || typeof ledger !== 'object') return null;
  const turns = Array.isArray(ledger.turns) ? ledger.turns : [];
  const session = ledger.session && typeof ledger.session === 'object' ? ledger.session : null;
  if (turns.length === 0 && !session) return null;
  return { session, turns };
}

// Map one ledger record (turn or session totals) onto the usage shape the ACP
// stream uses. Cache writes are folded into input — Grok publishes no separate
// cache-write rate and pre-1.0 those tokens were part of inputTokens, so
// folding keeps cross-version totals identical and leaves the Anthropic-only
// cache-creation bucket untouched. Any per-model modelUsage map is carried
// through (and folded the same way) so model attribution works exactly like
// the ACP path.
function ledgerRecordUsage(record) {
  if (!record || typeof record !== 'object') return null;
  const fold = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    return {
      ...entry,
      inputTokens: count(entry.inputTokens) + count(entry.cacheCreationTokens),
    };
  };
  const folded = fold(record);
  const modelUsage = record.modelUsage && typeof record.modelUsage === 'object'
    ? Object.fromEntries(Object.entries(record.modelUsage).map(([model, entry]) => [model, fold(entry)]))
    : null;
  const usage = { ...folded, ...(modelUsage ? { modelUsage } : {}) };
  const total = count(usage.inputTokens) + count(usage.cachedReadTokens)
    + count(usage.outputTokens) + count(usage.reasoningTokens);
  return total > 0 || hasUsageCounters(record) ? usage : null;
}

async function forEachJsonl(path, callback) {
  if (!existsSync(path)) return 0;
  let malformed = 0;
  const input = createReadStream(path, { encoding: 'utf8', highWaterMark: 256 * 1024 });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try { callback(JSON.parse(line)); } catch { malformed += 1; }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return malformed;
}

// Reconcile by turn, never by whole session: a resumed 0.x session can hold
// ACP usage for old turns and ledger-only usage for new ones. Explicit ledger
// turn numbers are 1-based; a numberless ledger can use order only when its
// length exactly matches the complete ACP stream. Ambiguous joins stay partial.
function emitLedgerUsage(entries, { ledger, turns, malformed, fallbackModel, project }) {
  if (!ledger) return false;
  if (malformed) return true; // A missing ACP line makes ordinal joins unsafe.
  if (!ledger.turns.length) {
    // Session totals have no occurrence time. Neither summary.updated_at nor
    // the final completion event can assign the entire session to one bucket.
    // Keep independently timed ACP usage, but never synthesize timed evidence.
    return !turns.length || !turns.every((turn) => turn.accounted);
  }
  if (turns.length && (ledger.turns.length > turns.length
    || ledger.turns.some((record) => record?.turnNumber > turns.length))) return true;
  const counts = new Map();
  for (const record of ledger.turns) {
    if (record?.turnNumber != null) counts.set(record.turnNumber, (counts.get(record.turnNumber) || 0) + 1);
  }
  let incomplete = false;
  for (const [index, record] of ledger.turns.entries()) {
    const number = record?.turnNumber;
    const numbered = Number.isSafeInteger(number) && number > 0 && counts.get(number) === 1;
    if (number != null && !numbered) { incomplete = true; continue; }
    let timestamp = null;
    let turn;
    if (turns.length) {
      const ordered = number == null && ledger.turns.length === turns.length;
      turn = numbered || ordered ? turns[numbered ? number - 1 : index] : null;
      if (!turn) { incomplete = true; continue; }
      if (turn.accounted) continue; // ACP copy wins; do not double-count.
      timestamp = turn.timestamp;
    }
    const usage = ledgerRecordUsage(record);
    if (!timestamp || !hasUsageCounters(usage)) { incomplete = true; continue; }
    emitTurnUsage(entries, { usage, model: fallbackModel, project, timestamp });
    if (turn) turn.accounted = true;
  }
  return incomplete;
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
  const unreadSessions = [];
  const incompleteSessions = [];
  for (const { sessionId, sessionPath, fallbackProject } of winners.values()) {
    const summary = readJson(join(sessionPath, 'summary.json')) || {};
    const projectPath = summary.info?.cwd || summary.git_root_dir;
    const project = projectPath ? projectName(projectPath) : fallbackProject;
    const fallbackModel = summary.current_model_id || 'unknown';
    const sessionEntryStart = entries.length;
    let sawMessages = false;
    const turns = [];
    const malformed = await forEachJsonl(join(sessionPath, 'updates.jsonl'), (record) => {
      const update = record?.params?.update;
      if (!update || typeof update !== 'object') return;
      const timestamp = toDate(record.timestamp);
      if (update.sessionUpdate === 'turn_completed') {
        // Preserve even invalid timestamp slots: removing one shifts every
        // subsequent ledger turn onto the wrong date.
        const before = entries.length;
        emitTurnUsage(entries, { usage: update.usage, model: fallbackModel, project, timestamp });
        turns.push({ timestamp, accounted: Boolean(timestamp
          && (entries.length > before || hasUsageCounters(update.usage))) });
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
    const ledger = readUsageLedger(sessionPath);
    const ambiguous = emitLedgerUsage(entries, { ledger, turns, malformed, fallbackModel, project });
    const incomplete = malformed > 0 || ambiguous || turns.some((turn) => !turn.accounted);
    if (incomplete) incompleteSessions.push(sessionId);
    // Canary for the next on-disk format move: a session whose signals.json
    // reports completed turns (and a model) but whose usage we could not read
    // from either source is a silent collection gap, not an idle session —
    // 1.0 moved the ledger to usage.json exactly like this.
    const readCounters = turns.some((turn) => turn.accounted)
      || (ledger?.turns?.length ? ledger.turns : [ledger?.session]).some(hasUsageCounters);
    if (entries.length === sessionEntryStart && !readCounters) {
      const signals = readJson(join(sessionPath, 'signals.json'));
      const turnCount = count(signals?.turnCount);
      const modelsUsed = Array.isArray(signals?.modelsUsed) ? signals.modelsUsed.filter(Boolean) : [];
      if (turnCount > 0 && modelsUsed.length > 0) {
        unreadSessions.push({ sessionId, turnCount });
      }
    }
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
  const unreadIds = new Set(unreadSessions.map((session) => session.sessionId));
  const partialCount = incompleteSessions.filter((id) => !unreadIds.has(id)).length;
  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(events, sessionSalt),
    ...((unreadSessions.length > 0 || incompleteSessions.length > 0) && {
      skipped: true,
      warnings: [
        ...(unreadSessions.length ? [`grok: ${unreadSessions.length} session(s) completed turns but reported no readable usage ` +
        `(e.g. ${unreadSessions[0].sessionId}, ${unreadSessions[0].turnCount} turn(s)); Grok may have changed ` +
        'its on-disk usage format again. No usage was uploaded for these sessions.'] : []),
        ...(partialCount
          ? [`grok: ${partialCount} session(s) have usage that could not be matched to reliable turn timestamps or readable counters; only independently timed turns are retained and the source is partial.`] : []),
      ],
    }),
  };
}
