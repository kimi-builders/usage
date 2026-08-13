const SOURCE_IDS = new Set([
  'kimi-code', 'claude-code', 'codex', 'gemini-cli', 'opencode', 'copilot-cli',
  'grok', 'craft-agent', 'cursor', 'dimagent', 'openclaw', 'omp',
  'pi-coding-agent', 'qwen-code', 'amp', 'droid', 'antigravity', 'trae-cli',
  'hermes', 'kiro', 'mimocode', 'cline', 'roo-code', 'zcode', 'workbuddy',
]);

const MAX_TOKEN_COUNT = 1_000_000_000_000_000;
const MAX_COUNT = 1_000_000_000;
const MAX_SECONDS = 366 * 24 * 60 * 60;

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function text(value, field, maxLength) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new Error(`${field} is invalid`);
  }
  return cleaned;
}

function safeInteger(value, field, max = MAX_TOKEN_COUNT) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${field} must be a non-negative safe integer no greater than ${max}`);
  }
  return value;
}

function timestamp(value, field) {
  const raw = text(value, field, 35);
  const time = Date.parse(raw);
  const now = Date.now();
  if (
    !Number.isFinite(time)
    || time < now - 5 * 366 * 24 * 60 * 60 * 1000
    || time > now + 10 * 60 * 1000
  ) {
    throw new Error(`${field} is outside the accepted window`);
  }
  return new Date(time);
}

function source(value, field) {
  const id = text(value, field, 40);
  if (!SOURCE_IDS.has(id)) throw new Error(`${field} is unsupported: ${id}`);
}

function project(value, field) {
  if (value === undefined) return;
  const label = text(value, field, 120);
  if (label === '.' || label === '..' || /[\\/]/.test(label)) {
    throw new Error(`${field} must be a directory basename`);
  }
}

function optionalText(value, field, maxLength) {
  if (value === undefined) return;
  text(value, field, maxLength);
}

function validateBucket(value) {
  const item = record(value, 'bucket');
  source(item.source, 'bucket.source');
  text(item.model, 'bucket.model', 160);
  optionalText(item.modelCanonical, 'bucket.modelCanonical', 160);
  optionalText(item.modelProvider, 'bucket.modelProvider', 80);
  optionalText(item.reasoningEffort, 'bucket.reasoningEffort', 32);
  optionalText(item.agentVersion, 'bucket.agentVersion', 80);
  if (item.contextTier !== undefined
    && !new Set(['short', 'long']).has(text(item.contextTier, 'bucket.contextTier', 16))) {
    throw new Error('bucket.contextTier is unsupported');
  }
  if (item.processingTier !== undefined
    && !new Set(['standard', 'batch', 'flex', 'priority']).has(
      text(item.processingTier, 'bucket.processingTier', 16),
    )) {
    throw new Error('bucket.processingTier is unsupported');
  }
  project(item.project, 'bucket.project');
  const bucketStart = timestamp(item.bucketStart, 'bucket.bucketStart');
  if (
    bucketStart.getUTCMinutes() % 30 !== 0
    || bucketStart.getUTCSeconds() !== 0
    || bucketStart.getUTCMilliseconds() !== 0
  ) {
    throw new Error('bucket.bucketStart must align to a UTC 30-minute boundary');
  }
  for (const field of [
    'inputTokens', 'cacheWriteInputTokens', 'cacheReadInputTokens',
    'outputTokens', 'reasoningOutputTokens',
  ]) safeInteger(item[field], `bucket.${field}`);
  const cacheWrite5m = item.cacheWrite5mInputTokens === undefined
    ? 0
    : safeInteger(item.cacheWrite5mInputTokens, 'bucket.cacheWrite5mInputTokens');
  const cacheWrite1h = item.cacheWrite1hInputTokens === undefined
    ? 0
    : safeInteger(item.cacheWrite1hInputTokens, 'bucket.cacheWrite1hInputTokens');
  if (cacheWrite5m + cacheWrite1h > item.cacheWriteInputTokens) {
    throw new Error('bucket cache-write TTL partitions cannot exceed cacheWriteInputTokens');
  }
  safeInteger(item.requestCount, 'bucket.requestCount', MAX_COUNT);
  if (item.creditUnits !== undefined && (
    typeof item.creditUnits !== 'number'
    || !Number.isFinite(item.creditUnits)
    || item.creditUnits < 0
    || item.creditUnits > MAX_TOKEN_COUNT
  )) throw new Error('bucket.creditUnits must be a non-negative number');
  const measurement = text(item.measurement, 'bucket.measurement', 16);
  if (!new Set(['exact', 'estimated', 'credit']).has(measurement)) {
    throw new Error('bucket.measurement is unsupported');
  }
}

function validateSession(value) {
  const item = record(value, 'session');
  source(item.source, 'session.source');
  optionalText(item.agentVersion, 'session.agentVersion', 80);
  project(item.project, 'session.project');
  const sessionHash = text(item.sessionHash, 'session.sessionHash', 64);
  if (!/^[0-9a-f]{64}$/i.test(sessionHash)) {
    throw new Error('session.sessionHash must be a 64-character HMAC-SHA-256 digest');
  }
  const firstMessageAt = timestamp(item.firstMessageAt, 'session.firstMessageAt');
  const lastMessageAt = timestamp(item.lastMessageAt, 'session.lastMessageAt');
  if (lastMessageAt < firstMessageAt) throw new Error('session end precedes session start');
  safeInteger(item.durationSeconds, 'session.durationSeconds', MAX_SECONDS);
  const activeSeconds = safeInteger(item.activeSeconds, 'session.activeSeconds', MAX_SECONDS);
  safeInteger(item.messageCount, 'session.messageCount', MAX_COUNT);
  const userMessageCount = safeInteger(item.userMessageCount, 'session.userMessageCount', MAX_COUNT);
  if (!Array.isArray(item.userPromptHours) || item.userPromptHours.length !== 24) {
    throw new Error('session.userPromptHours must contain exactly 24 counters');
  }
  item.userPromptHours.forEach((count, hour) =>
    safeInteger(count, `session.userPromptHours[${hour}]`, MAX_COUNT));
  if (item.activityHours === undefined) return;
  if (!Array.isArray(item.activityHours) || item.activityHours.length > 2_000) {
    throw new Error('session.activityHours must contain at most 2000 items');
  }
  const firstHour = Math.floor(firstMessageAt.getTime() / 3_600_000) * 3_600_000;
  const lastHour = Math.floor(lastMessageAt.getTime() / 3_600_000) * 3_600_000;
  const seen = new Set();
  let hourActiveSeconds = 0;
  let hourEngagedSeconds = 0;
  let hourMessageCount = 0;
  let hourUserMessages = 0;
  let hasExtendedHours = false;
  item.activityHours.forEach((value, index) => {
    const hour = record(value, `session.activityHours[${index}]`);
    const hourStart = timestamp(hour.hourStart, `session.activityHours[${index}].hourStart`);
    const iso = hourStart.toISOString();
    if (
      hourStart.getUTCMinutes() !== 0
      || hourStart.getUTCSeconds() !== 0
      || hourStart.getUTCMilliseconds() !== 0
      || seen.has(iso)
    ) throw new Error('session.activityHours must use unique UTC hour boundaries');
    if (hourStart.getTime() < firstHour || hourStart.getTime() > lastHour) {
      throw new Error(`session.activityHours[${index}] falls outside the session window`);
    }
    seen.add(iso);
    hourActiveSeconds += safeInteger(
      hour.activeSeconds,
      `session.activityHours[${index}].activeSeconds`,
      3_600,
    );
    if (hour.engagedSeconds !== undefined || hour.messageCount !== undefined) {
      if (hour.engagedSeconds === undefined || hour.messageCount === undefined) {
        throw new Error('session activity hours must provide engagedSeconds and messageCount together');
      }
      hasExtendedHours = true;
      hourEngagedSeconds += safeInteger(
        hour.engagedSeconds,
        `session.activityHours[${index}].engagedSeconds`,
        3_600,
      );
      hourMessageCount += safeInteger(
        hour.messageCount,
        `session.activityHours[${index}].messageCount`,
        MAX_COUNT,
      );
    }
    hourUserMessages += safeInteger(
      hour.userMessageCount,
      `session.activityHours[${index}].userMessageCount`,
      MAX_COUNT,
    );
  });
  if (hourActiveSeconds !== activeSeconds || hourUserMessages !== userMessageCount) {
    throw new Error('session.activityHours totals must match the session counters');
  }
  if (hasExtendedHours
    && (hourEngagedSeconds !== item.durationSeconds || hourMessageCount !== item.messageCount)) {
    throw new Error('session extended activity hours must match duration and message counters');
  }
}

function validationError(validate, value) {
  try {
    validate(value);
    return null;
  } catch (error) {
    return error?.message || String(error);
  }
}

export function validateUploadBucket(value) {
  return validationError(validateBucket, value);
}

export function validateUploadSession(value) {
  return validationError(validateSession, value);
}
