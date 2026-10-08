import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir } from '../config.js';

// v2 adds an optional per-provider plan identity so evidence can be segmented
// when the subscription plan changes. v1 files simply carry unknown plans.
const HISTORY_SCHEMA_VERSION = 2;
const RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;
const RECENT_MS = 2 * 24 * 60 * 60 * 1_000;
const MIDTERM_MS = 45 * 24 * 60 * 60 * 1_000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_OBSERVATIONS = 20_000;

function defaultPath() {
  return join(getConfigDir(), 'subscription-history.json');
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedPercent(value) {
  const number = finite(value);
  return number == null ? null : Math.max(0, Math.min(100, number));
}

function iso(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function sanitizeWindow(window) {
  const id = String(window?.id || '').slice(0, 160);
  if (!id) return null;
  return {
    id,
    label: String(window?.label || id).slice(0, 160),
    usedPercent: boundedPercent(window?.usedPercent),
    remainingPercent: boundedPercent(window?.remainingPercent),
    resetsAt: iso(window?.resetsAt),
    windowSeconds: Math.max(0, Math.round(finite(window?.windowSeconds) || 0)) || null,
    value: finite(window?.value),
    limit: finite(window?.limit),
    unit: window?.unit ? String(window.unit).slice(0, 40) : null,
  };
}

function sanitizePlan(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || null;
}

function sanitizeProvider(provider) {
  const id = String(provider?.id || '').slice(0, 100);
  // Fresh snapshots carry status; normalized history intentionally does not.
  if (!id || (provider?.status != null && provider.status !== 'ok')) return null;
  const windows = (provider.windows || []).map(sanitizeWindow).filter(Boolean);
  if (!windows.length) return null;
  const observedAt = iso(provider?.observedAt);
  const scopedAccountId = provider.id === 'kimi-code' && /^kimi_[a-f0-9]{32}$/.test(provider.historyAccountId || '')
    ? provider.historyAccountId : provider.accountId;
  const accountId = /^[A-Za-z0-9_-]{1,80}$/.test(String(scopedAccountId || ''))
    ? String(scopedAccountId)
    : null;
  const plan = sanitizePlan(provider?.plan);
  return {
    id,
    ...(accountId ? { accountId } : {}),
    ...(plan ? { plan } : {}),
    ...(observedAt ? { observedAt } : {}),
    windows,
  };
}

function sanitizeObservation(observation, { fallbackProviderObservedAt = true } = {}) {
  const observedAt = iso(observation?.observedAt);
  if (!observedAt) return null;
  // Schema v1 stored time only on the observation container. Normalize those
  // files forward by copying that real legacy time to providers which do not
  // yet carry their own timestamp. Never invent a time for malformed input.
  const providers = (observation.providers || []).map((provider) => {
    const hasProviderObservedAt = Object.prototype.hasOwnProperty.call(provider || {}, 'observedAt');
    const providerObservedAt = hasProviderObservedAt
      ? iso(provider?.observedAt)
      : fallbackProviderObservedAt ? observedAt : null;
    if (!providerObservedAt) return null;
    return sanitizeProvider({ ...provider, observedAt: providerObservedAt });
  }).filter(Boolean);
  if (!providers.length) return null;
  return { observedAt, providers };
}

function intervalForAge(age) {
  if (age <= RECENT_MS) return FIFTEEN_MINUTES_MS;
  if (age <= MIDTERM_MS) return HOUR_MS;
  return DAY_MS;
}

export function compactLimitHistory(observations, { now = Date.now() } = {}) {
  const valid = (observations || []).map(sanitizeObservation).filter(Boolean).filter((observation) => {
    const time = Date.parse(observation.observedAt);
    return time <= now + 5 * 60 * 1_000 && time >= now - RETENTION_MS;
  }).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const buckets = new Map();
  const plans = new Map();
  const providerKey = (provider) => `${provider.id}\u0000${provider.accountId || ''}`;
  let segment = 0;
  for (const observation of valid) {
    // A plan transition is an evidence boundary, including known -> unknown
    // -> known and returns to an earlier tier. Never compact across it, even
    // when both observations fall in the same 15-minute/hour/day bucket.
    // Keeping real boundary observations (not synthetic identities) survives
    // repeated load/save compaction and still obeys retention/count limits.
    if (observation.providers.some((provider) => plans.has(providerKey(provider))
      && plans.get(providerKey(provider)) !== (provider.plan?.toLowerCase() || null))) segment += 1;
    for (const provider of observation.providers) {
      plans.set(providerKey(provider), provider.plan?.toLowerCase() || null);
    }
    const time = Date.parse(observation.observedAt);
    const interval = intervalForAge(Math.max(0, now - time));
    const key = `${interval}:${Math.floor(time / interval)}:${segment}`;
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, observation);
      continue;
    }
    const providers = new Map(current.providers.map((provider) => [providerKey(provider), provider]));
    for (const provider of observation.providers) {
      // A successful provider result is a complete fact set for that provider.
      // Replacing it prevents a disappeared window from inheriting the newer
      // observation timestamp, while providers absent from this partial poll
      // remain represented by their latest result in the bucket.
      providers.set(providerKey(provider), provider);
    }
    buckets.set(key, { observedAt: observation.observedAt, providers: [...providers.values()] });
  }
  return [...buckets.values()].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
    .slice(-MAX_OBSERVATIONS);
}

export function normalizeLimitHistory(payload, options = {}) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    observations: compactLimitHistory(payload?.observations, options),
  };
}

export function loadLimitHistory({ path = defaultPath(), now = Date.now() } = {}) {
  if (!existsSync(path)) return normalizeLimitHistory(null, { now });
  try {
    return normalizeLimitHistory(JSON.parse(readFileSync(path, 'utf8')), { now });
  } catch {
    return normalizeLimitHistory(null, { now });
  }
}

export function recordLimitSnapshot(snapshot, { path = defaultPath(), now = Date.now() } = {}) {
  const observedAt = iso(snapshot?.generatedAt);
  const observation = observedAt ? sanitizeObservation({
    observedAt,
    providers: (snapshot?.providers || []).flatMap((provider) => {
      const values = Array.isArray(provider?.accounts) && provider.accounts.length
        ? provider.accounts.filter(account => provider.id !== 'kimi-code' || !account.duplicateOf)
          .map((account) => ({ ...account, id: provider.id }))
        : [provider];
      return values.map((value) => ({
        ...value,
        observedAt: iso(value?.updatedAt),
      }));
    }),
  }, { fallbackProviderObservedAt: false }) : null;
  const current = loadLimitHistory({ path, now });
  if (!observation) return current;
  const next = normalizeLimitHistory({ observations: [...current.observations, observation] }, { now });
  const directory = dirname(path);
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(temporary, `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  }
  return next;
}

export function getLimitHistoryPath() {
  return defaultPath();
}
