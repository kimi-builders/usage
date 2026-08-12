import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getConfigDir } from '../config.js';

const HISTORY_SCHEMA_VERSION = 1;
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

function sanitizeProvider(provider) {
  const id = String(provider?.id || '').slice(0, 100);
  if (!id || provider?.status !== 'ok') return null;
  const windows = (provider.windows || []).map(sanitizeWindow).filter(Boolean);
  if (!windows.length) return null;
  return {
    id, status: 'ok',
    label: String(provider?.label || id).slice(0, 100),
    plan: provider?.plan ? String(provider.plan).slice(0, 100) : null,
    windows,
  };
}

function sanitizeObservation(observation) {
  const observedAt = iso(observation?.observedAt);
  if (!observedAt) return null;
  const providers = (observation.providers || []).map(sanitizeProvider).filter(Boolean);
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
  for (const observation of valid) {
    const time = Date.parse(observation.observedAt);
    const interval = intervalForAge(Math.max(0, now - time));
    buckets.set(`${interval}:${Math.floor(time / interval)}`, observation);
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
  const observedAt = iso(snapshot?.generatedAt) || new Date(now).toISOString();
  const observation = sanitizeObservation({ observedAt, providers: snapshot?.providers });
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
