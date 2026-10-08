import { requestJson } from '../http.js';

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(time) && Number.isFinite(+calendar) && calendar.toISOString().slice(0, 10) === value.slice(0, 10)
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60
    ? new Date(time).toISOString() : null;
}

export function claudeResetCredits(value, now = new Date()) {
  if (value?.eligible !== true || !Array.isArray(value.grants) || value.grants.length > 200) return null;
  let availableCount = 0; const expiries = [];
  for (const grant of value.grants) {
    if (!Number.isSafeInteger(grant?.resets_left) || grant.resets_left < 0 || grant.paused !== false) continue;
    if (grant.resets_total != null && (!Number.isSafeInteger(grant.resets_total) || grant.resets_total < grant.resets_left)) continue;
    const start = grant.starts_at == null ? null : date(grant.starts_at);
    const end = grant.ends_at == null ? null : date(grant.ends_at);
    if (grant.starts_at != null && !start || grant.ends_at != null && !end
      || start && Date.parse(start) > +now || end && Date.parse(end) <= +now) continue;
    availableCount += grant.resets_left;
    if (availableCount > 50) return null;
    if (grant.resets_left && end) expiries.push(end);
  }
  return { availableCount, nextExpiry: expiries.sort()[0] || null };
}

export function claudeCloudCredits(value) {
  if (!number(value?.limit_dollars) || value.limit_dollars <= 0) return null;
  if (value.locked_reason != null && typeof value.locked_reason !== 'string') return null;
  const limit = value.limit_dollars;
  const remaining = value.remaining_dollars;
  const used = value.used_dollars;
  if (remaining != null && (!number(remaining) || remaining > limit)
    || used != null && (!number(used) || used > limit) || remaining == null && used == null) return null;
  const expiresAt = value.resets_at == null ? null : date(value.resets_at);
  if (value.resets_at != null && !expiresAt) return null;
  const left = remaining ?? limit - used;
  return { limit, remaining: left, used: limit - left, expiresAt,
    locked: typeof value.locked_reason === 'string' && Boolean(value.locked_reason.trim()) };
}

export function claudeSubscriptionDates(value) {
  const keys = ['next_charge_at', 'next_charge_date', 'plan_ending_at', 'plan_ending_before'];
  if (!['active', 'trialing', 'canceled'].includes(value?.status) || !keys.every(key => Object.hasOwn(value, key))) return null;
  const values = keys.map(key => {
    const raw = value[key];
    if (raw == null) return null;
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString().slice(0, 10) === raw) return raw;
    return date(raw) || false;
  });
  if (values.includes(false)) return null;
  const expiresAt = values[2] || values[3];
  return { expiresAt, renewsAt: !expiresAt && value.status !== 'canceled' ? values[0] || values[1] : null };
}

const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value) ? value.toLowerCase() : null;
function owner(value) {
  const account = uuid(value?.account?.uuid ?? value?.accountUuid ?? value?.account_uuid);
  const organization = uuid(value?.organization?.uuid ?? value?.organizationUuid ?? value?.organization_uuid);
  // Strong account + organization binding, not a name/email guess.
  return account && organization ? { account, organization } : null;
}
function matchesWeb(value, expected) {
  return uuid(value?.uuid) === expected.account && Array.isArray(value.memberships)
    && value.memberships.some(item => uuid(item?.organization?.uuid) === expected.organization);
}

// Explicit cookie only. It must belong to the exact OAuth account and org used
// for usage, before AND after the optional lookup. No credential discovery.
export async function fetchClaudeSubscriptionDates(accessToken, sessionCookie, { fetcher = fetch } = {}) {
  if (typeof sessionCookie !== 'string' || !sessionCookie.trim() || sessionCookie.length > 32_768 || /[\r\n\0]/.test(sessionCookie)) return null;
  const deadline = Date.now() + 2_000;
  const get = (url, headers) => {
    if (Date.now() >= deadline) throw new Error('Optional metadata deadline');
    return requestJson(url, { headers, fetcher, timeoutMs: Math.max(1, deadline - Date.now()) });
  };
  const profile = () => get('https://api.anthropic.com/api/oauth/profile', { Authorization: `Bearer ${accessToken}` });
  const web = path => get(`https://claude.ai/api/${path}`, { Cookie: sessionCookie });
  try {
    const expected = owner(await profile());
    if (!expected || !matchesWeb(await web('account'), expected)) return null;
    const result = claudeSubscriptionDates(await web(`organizations/${expected.organization}/subscription_details`));
    if (!result || !matchesWeb(await web('account'), expected)) return null;
    const after = owner(await profile());
    return after?.account === expected.account && after.organization === expected.organization ? result : null;
  } catch { return null; }
}
