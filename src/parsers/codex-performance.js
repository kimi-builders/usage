import { counters } from './codex-usage.js';
import { canonicalModelId } from '../model-meta.js';

const id = value => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : null;
const time = value => typeof value === 'number' ? value : Date.parse(value);

export function compactCodexCompletion(payload) {
  return { type: payload.type, turn_id: payload.turn_id, duration_ms: payload.duration_ms,
    time_to_first_token_ms: payload.time_to_first_token_ms, started_at: payload.started_at,
    // Keep a flag, never the provider's raw error/message/tool payload.
    error: payload.error != null ? true : null };
}

// Only durable, explicitly owned request ledgers plus successful completion
// timing form performance evidence. Legacy token_count/activity approximations
// are NOT timings, and foreign/copied parent requests cannot form samples.
export function codexTurnPerformance(records, sessionId, executionId, metadata = {}) {
  const turns = new Map(); const responses = new Map();
  let contextModel = null; let contextEffort = null; let contextTurn = null;
  const turnFor = key => {
    if (!turns.has(key)) turns.set(key, { rows: [], invalid: false, completion: null });
    return turns.get(key);
  };
  for (const record of records) {
    const p = record.payload || {};
    if (record.type === 'turn_context') {
      contextModel = id(p.model); contextEffort = id(p.effort);
      contextTurn = id(p.turn_id);
    }
    const turnId = id(p.turn_id);
    if (!turnId) {
      if (contextTurn && (record.type === 'token_usage_record' && p.thread_id === sessionId
        || record.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(p.type))) turnFor(contextTurn).invalid = true;
      continue;
    }
    if (record.type === 'event_msg' && p.type === 'task_started') contextTurn = turnId;
    if (record.type === 'event_msg' && ['task_complete', 'turn_aborted'].includes(p.type)) {
      const turn = turnFor(turnId);
      const ended = time(record.timestamp);
      const started = p.started_at == null ? null : p.started_at * 1_000;
      if (p.type === 'turn_aborted' || p.error != null || !Number.isFinite(ended)
        || !Number.isSafeInteger(p.duration_ms) || p.duration_ms <= 0
        || p.started_at != null && (!Number.isSafeInteger(p.started_at) || !Number.isSafeInteger(started) || started < 0 || started > ended)) {
        turn.invalid = true; continue;
      }
      const first = Number.isSafeInteger(p.time_to_first_token_ms) && p.time_to_first_token_ms >= 0
        && p.time_to_first_token_ms <= p.duration_ms ? p.time_to_first_token_ms : null;
      const completion = { ended, started, durationMs: p.duration_ms, firstTokenMs: first };
      if (turn.completion && JSON.stringify(turn.completion) !== JSON.stringify(completion)) turn.invalid = true;
      turn.completion = completion;
    }
    if (record.type !== 'token_usage_record') continue;
    if (p.thread_id !== sessionId || p.session_id != null && p.session_id !== executionId) continue;
    const turn = turnFor(turnId);
    const usage = counters(p.usage, true);
    const thread = counters(p.thread_token_usage, true);
    const turnTotal = counters(p.turn_token_usage, true);
    const responseId = id(p.response_id);
    const at = time(record.timestamp);
    if (!responseId || !usage || !thread || !Number.isFinite(at)
      || thread.output_tokens < usage.output_tokens || thread.input_tokens < usage.input_tokens
      || p.turn_token_usage != null && !turnTotal) { turn.invalid = true; continue; }
    const row = { at, usage, turnTotal, model: id(p.model) || contextModel, reasoningEffort: contextEffort };
    const previous = responses.get(responseId);
    if (previous) {
      // A duplicate ledger is harmless; conflicting ownership/counters are not.
      if (previous.turnId !== turnId || JSON.stringify(previous.row.usage) !== JSON.stringify(usage)
        || JSON.stringify(previous.row.turnTotal) !== JSON.stringify(turnTotal) || previous.row.model !== row.model) {
        turn.invalid = true; turnFor(previous.turnId).invalid = true;
      }
      continue;
    }
    responses.set(responseId, { turnId, row }); turn.rows.push(row);
  }
  const samples = [];
  for (const turn of turns.values()) {
    const completion = turn.completion;
    if (turn.invalid || !completion || !turn.rows.length) continue;
    const sum = field => turn.rows.reduce((total, row) => total + row.usage[field], 0);
    const outputTokens = sum('output_tokens');
    const lastTotal = turn.rows.at(-1).turnTotal;
    // When a final turn total is absent we cannot prove complete coverage.
    if (!lastTotal || !Number.isSafeInteger(outputTokens) || outputTokens <= 0
      || ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens']
        .some(field => !Number.isSafeInteger(sum(field)) || sum(field) !== lastTotal[field])
      || turn.rows.some(row => row.at > completion.ended || row.at < (completion.started ?? completion.ended - completion.durationMs))) continue;
    const unique = field => { const values = new Set(turn.rows.map(row => row[field])); return values.size === 1 ? [...values][0] : null; };
    const model = unique('model') || 'unknown';
    samples.push({ source: 'codex', project: metadata.project || '', agentVersion: metadata.agentVersion || '',
      model, modelCanonical: canonicalModelId({ source: 'codex', model }), reasoningEffort: unique('reasoningEffort') || '',
      completedAt: new Date(completion.ended).toISOString(), durationMs: completion.durationMs,
      firstTokenMs: completion.firstTokenMs, outputTokens });
  }
  return samples;
}
