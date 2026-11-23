// Durable request-ledger support informed by vibe-usage and CodexBar. Keep
// only accounting/identity fields in memory; never retain arbitrary payloads.
const FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];
const KEYS = [...FIELDS, 'cache_read_input_tokens', 'total_tokens'];
const pickUsage = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(KEYS.filter((key) => key in value).map((key) => [key,
    typeof value[key] === 'number' || typeof value[key] === 'string' && /^\d+(?:\.\d+)?$/.test(value[key]) && value[key].length < 32
      ? value[key] : NaN,
  ])) : null;
const identity = (value) => typeof value === 'string' && value.trim() && value.length <= 512 ? value.trim() : null;

export function compactCodexUsage(record) {
  const p = record.payload || {};
  const info = p.info || {};
  return {
    type: record.type, timestamp: record.timestamp,
    payload: record.type === 'token_usage_record' ? {
      thread_id: p.thread_id, session_id: p.session_id, response_id: p.response_id, turn_id: p.turn_id,
      model: p.model, service_tier: p.service_tier,
      usage: pickUsage(p.usage), thread_token_usage: pickUsage(p.thread_token_usage),
      turn_token_usage: pickUsage(p.turn_token_usage),
    } : {
      type: 'token_count', turn_id: p.turn_id, model: p.model, service_tier: p.service_tier,
      info: { model: info.model, service_tier: info.service_tier,
        last_token_usage: pickUsage(info.last_token_usage), total_token_usage: pickUsage(info.total_token_usage) },
    },
  };
}

export function counters(value, strict = false) {
  if (!value || typeof value !== 'object') return null;
  if (strict && value.total_tokens != null && (!Number.isSafeInteger(value.total_tokens) || value.total_tokens < 0)) return null;
  const values = {};
  for (const key of FIELDS) {
    const raw = key === 'cached_input_tokens' ? value[key] ?? value.cache_read_input_tokens : value[key];
    if (strict && raw == null && ['input_tokens', 'output_tokens'].includes(key)) return null;
    const number = raw == null ? 0 : Number(raw);
    if (strict && (raw != null && typeof raw !== 'number' || !Number.isSafeInteger(number) || number < 0)) return null;
    values[key] = Number.isFinite(number) && number > 0 ? number : 0;
  }
  const sum = values.input_tokens + values.output_tokens;
  if (strict && (!Number.isSafeInteger(sum)
    || values.cached_input_tokens + values.cache_write_input_tokens > values.input_tokens
    || values.reasoning_output_tokens > values.output_tokens)) return null;
  values.total_tokens = strict ? sum : (Number(value.total_tokens) || 0);
  return values;
}

function equal(a, b) { return a && b && FIELDS.every((key) => a[key] === b[key]); }
function atLeast(a, b) { return FIELDS.every((key) => a[key] >= b[key]); }
function advance(total, previous) {
  return total && previous ? Object.fromEntries(FIELDS.map((key) => [key, total[key] - previous[key]])) : null;
}

function mirrors(a, b, anchor) {
  if (!a || a.kind === b.kind || a.turn !== b.turn || !equal(a.usage, b.usage)) return false;
  if (a.model && b.model && a.model !== b.model) return false;
  const ledger = a.kind === 'ledger' ? a : b;
  const legacy = a.kind === 'legacy' ? a : b;
  if (equal(ledger.total, legacy.total) || equal(ledger.turnTotal, legacy.total)) return true;
  if (a.time === b.time) return true;
  // A resumed UI stream can be AHEAD of the thread ledger, or emit its
  // mirror seconds later. The counters live in different domains: compare
  // each stream to its own previous sample. Matching positive deltas on both
  // sides of adjacent, same-turn records are stronger evidence than the
  // relative sizes of the two totals or the wall-clock delay.
  if (a.turn && !ledger.duplicate && equal(ledger.advance, ledger.usage)
    && equal(legacy.advance, legacy.usage) && (Math.abs(a.time - b.time) <= 5_000
      || (anchor && equal(advance(ledger.total, anchor.ledger), ledger.usage)
        && equal(advance(legacy.total, anchor.legacy), legacy.usage)))) return true;
  // UI totals can lag the durable thread ledger by entire interrupted calls,
  // not just a small numerical drift. Compare each stream to its OWN previous
  // counter: an advance beyond this request proves an intervening request.
  if (!a.turn || ledger.duplicate || !a.total || !b.total || Math.abs(a.time - b.time) > 5_000) return false;
  if (b.advance && FIELDS.some((key) => b.advance[key] > b.usage[key])) return false;
  if (!atLeast(ledger.total, legacy.total)) return false;
  // With no earlier ledger baseline, a legacy-first tuple exactly one request
  // behind may simply be the preceding real call, not a delayed mirror.
  if (b.kind === 'ledger' && !b.advance && equal(advance(ledger.total, legacy.total), b.usage)) return false;
  return true;
}

export function reconcileCodexUsage(records, sessionId, executionId = sessionId) {
  let baseline = null;
  let ledgerBaseline = null;
  let lastPositiveTotal = 0;
  let pending = null;
  let anchor = null;
  let turn = null;
  let model = null;
  let ordinal = 0;
  let invalidRecords = 0;
  const seenResponses = new Set();
  const seenUnidentified = new Set();
  const output = [];
  for (const record of records) {
    const p = record.payload || {};
    const ownerExecution = record.segmentContext?.execution || executionId;
    if (record.type === 'turn_context') {
      turn = identity(p.turn_id) || `context:${++ordinal}`;
      model = identity(p.model) || model;
      pending = null;
    } else if (record.type === 'event_msg' && p.type === 'thread_settings_applied') {
      model = identity(p.thread_settings?.model) || model;
    } else if (record.type === 'session_meta' || record.type === 'event_msg'
      && ['task_started', 'turn_started', 'task_complete', 'turn_aborted', 'user_message'].includes(p.type)) {
      turn = identity(p.turn_id);
      pending = null;
    }
    const kind = record.type === 'token_usage_record' ? 'ledger'
      : record.type === 'event_msg' && p.type === 'token_count' ? 'legacy' : null;
    if (!kind) { output.push(record); continue; }
    const time = typeof record.timestamp === 'number' ? record.timestamp : Date.parse(record.timestamp);
    if (!Number.isFinite(time)) {
      if (kind === 'ledger') invalidRecords += 1;
      pending = null;
      continue;
    }
    let usage;
    let total;
    let duplicate = false;
    let foreign = false;
    let counterAdvance = null;
    if (kind === 'ledger') {
      usage = counters(p.usage, true);
      total = counters(p.thread_token_usage, true);
      if (!usage || !total || !atLeast(total, usage)
        || ['thread_id', 'session_id', 'response_id', 'turn_id'].some((key) => p[key] != null && !identity(p[key]))) {
        invalidRecords += 1;
        pending = null;
        continue;
      }
      // Explicit ownership beats copied parent history, even if the parent
      // is outside this scan. Older ledger shapes without ids use the rollout.
      foreign = Boolean(p.thread_id && p.thread_id !== sessionId || p.session_id && p.session_id !== ownerExecution);
      const response = identity(p.response_id);
      const key = response || JSON.stringify([total, usage]);
      const seen = response ? seenResponses : seenUnidentified;
      duplicate = seen.has(key);
      if (!foreign) seen.add(key);
      counterAdvance = advance(total, ledgerBaseline);
      if (!duplicate && !foreign) ledgerBaseline = total;
    } else {
      total = counters(p.info?.total_token_usage);
      const count = total?.total_tokens || 0;
      duplicate = count > 0 && count === lastPositiveTotal;
      usage = counters(p.info?.last_token_usage);
      if (!usage && total) {
        const delta = baseline && Object.fromEntries([...FIELDS, 'total_tokens'].map((key) => [key, total[key] - baseline[key]]));
        usage = !delta || Object.values(delta).some((value) => value < 0) ? total : delta;
      }
      counterAdvance = advance(total, baseline);
      // Mirrored legacy rows still advance their OWN baseline, so a later
      // cumulative-only UI event does not count the mirrored request again.
      if (total) baseline = total;
      if (count > 0) lastPositiveTotal = count;
      if (!usage) { pending = null; continue; }
    }
    const info = kind === 'ledger' ? {
      model: p.model, service_tier: p.service_tier,
      last_token_usage: usage, total_token_usage: total,
    } : { ...p.info, last_token_usage: usage };
    const normalized = { type: 'event_msg', timestamp: record.timestamp,
      ...(record.segmentMetadata ? { segmentMetadata: record.segmentMetadata } : {}),
      ...(record.segmentContext ? { segmentContext: record.segmentContext } : {}),
      ...(kind === 'ledger' && !foreign && (p.thread_id === sessionId || p.session_id === ownerExecution)
        ? { ownedRequest: true } : {}),
      payload: { type: 'token_count', model: p.model, service_tier: p.service_tier, info } };
    const candidate = {
      record: normalized, kind, usage, total, turnTotal: counters(p.turn_token_usage, true),
      turn: identity(p.turn_id) || turn, model: identity(info.model) || identity(p.model) || (record.segmentContext ? identity(record.segmentContext.model) : model),
      time, duplicate, advance: counterAdvance, ignored: duplicate || foreign,
    };
    if (mirrors(pending, candidate, anchor)) {
      const ledger = kind === 'ledger' ? candidate : pending;
      const legacy = kind === 'legacy' ? candidate : pending;
      legacy.ignored = true;
      anchor = ledger.ignored ? null : { ledger: ledger.total, legacy: legacy.total };
      // A delayed ledger owns the timestamp/accounting, while optional pricing
      // metadata that only existed on its UI mirror remains usable.
      ledger.record.payload.info.model ||= legacy.record.payload.info?.model || legacy.record.payload.model;
      ledger.record.payload.info.service_tier ||= legacy.record.payload.info?.service_tier || legacy.record.payload.service_tier;
      pending = null;
    } else {
      pending = candidate;
    }
    output.push(candidate);
  }
  return {
    records: output.filter((item) => !item.ignored).map((item) => item.record || item),
    warnings: invalidRecords ? [`codex: ${invalidRecords} invalid durable usage record(s); scan is incomplete`] : [],
  };
}
