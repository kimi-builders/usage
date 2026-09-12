import { createHash } from 'node:crypto';
import { resolveProviderSecret } from '../credentials.js';

export const REGIONAL_PLAN_IDS = ['glm', 'minimax', 'alibaba-coding'];
export function regionalCredentialKey(id, settings) {
  return REGIONAL_PLAN_IDS.includes(id) ? `${id}:${settings?.site === 'china' ? 'china' : 'international'}` : id;
}

export function planError(code = 'invalid_response') {
  return Object.assign(new Error('Coding Plan quota could not be verified.'), { code });
}

export function planSecret(id, settings, environment) {
  const secret = resolveProviderSecret(id, { ...settings, credentialKey: regionalCredentialKey(id, settings) }, environment);
  if (!secret) throw planError('not_configured');
  return secret;
}

export function planAccountId(id, settings, secret) {
  // Separate quota histories after changing account or region without storing
  // credentials or vendor identity. Credential rotation starts a new series.
  return createHash('sha256').update(`${regionalCredentialKey(id, settings)}\0${secret}`).digest('hex').slice(0, 32);
}

export async function withPlanAccount(id, settings, secret, operation) {
  const accountId = planAccountId(id, settings, secret);
  try { return { ...await operation(), accountId }; }
  catch (error) { error.accountId = accountId; throw error; }
}

export function quotaNumber(value) {
  if (value == null) return null;
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw planError();
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) throw planError();
  return n;
}

// Fixed bounds keep fixture replay deterministic and reject unset epochs or
// second/millisecond unit mistakes. These plans have no pre-2020 quota dates;
// dates at/after 2100 are not credible quota/reset timestamps either.
const MIN_QUOTA_DATE_MS = Date.UTC(2020, 0, 1);
const MAX_QUOTA_DATE_MS = Date.UTC(2100, 0, 1);

export function quotaDate(value) {
  if (!['number', 'string'].includes(typeof value)) return null;
  if (typeof value === 'string') value = value.trim();
  if (value === '') return null;
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(value);
  // Do not guess a timezone for a provider's wall-clock string.
  if (!numeric && !/(Z|[+-]\d\d:\d\d)$/.test(String(value))) return null;
  const date = numeric ? new Date(Number(value) * (Number(value) < 1e12 ? 1000 : 1)) : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) && time >= MIN_QUOTA_DATE_MS && time < MAX_QUOTA_DATE_MS ? date.toISOString() : null;
}

export function quotaWindow({ id, label, used, total, percent, unit, seconds, reset, now }) {
  if (percent == null) {
    if (!(total > 0) || used == null) return null;
    percent = used / total * 100;
  }
  if (!Number.isFinite(percent)) throw planError();
  percent = Math.max(0, Math.min(100, percent));
  let resetsAt = quotaDate(reset);
  if (seconds === 18000 && resetsAt && Date.parse(resetsAt) > now.getTime() + 18060000) resetsAt = null;
  return {
    id, label, usedPercent: percent, remainingPercent: 100 - percent,
    resetsAt, windowSeconds: seconds || null,
    value: used ?? null, limit: total ?? null, unit: unit || null,
  };
}

export function planSnapshot(id, label, windows, plan, now, notice) {
  if (windows.length > 64 || new Set(windows.map(w => w.id)).size !== windows.length) throw planError();
  return { id, label, status: windows.length ? 'ok' : 'empty', updatedAt: now.toISOString(),
    windows, plan: typeof plan === 'string' ? plan.slice(0, 160) : null, notice };
}
