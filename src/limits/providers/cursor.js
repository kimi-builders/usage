import {
  loadCursorCredentials, normalizeCookieSecret, resolveProviderSecret,
} from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const USAGE_URL = 'https://cursor.com/api/usage-summary';
const PROFILE_URL = 'https://cursor.com/api/auth/me';
const WEEKLY_URL = 'https://cursor.com/api/dashboard/get-sand-usage-status';
const MONTHLY_URL = 'https://cursor.com/api/dashboard/v2/usage-status?scope=user';

function numeric(value) {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function creditWindow(value, id, label, resetsAt, { percent } = {}) {
  if (!value || value.enabled === false) return null;
  const usedCents = numeric(value.used) ?? 0;
  const limitCents = numeric(value.limit);
  let usedPercent = percent == null ? null : asPercent(percent);
  if (usedPercent == null && limitCents != null && limitCents > 0) usedPercent = asPercent(usedCents / limitCents * 100);
  if (usedPercent == null) return null;
  return {
    id, label, usedPercent, remainingPercent: 100 - usedPercent, resetsAt,
    value: usedCents / 100, limit: limitCents == null ? null : limitCents / 100, unit: 'USD',
  };
}

function percentWindow(id, label, value, resetsAt) {
  const numericValue = numeric(value);
  const usedPercent = numericValue == null ? null : asPercent(numericValue);
  if (usedPercent == null) return null;
  return {
    id,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt,
    value: null,
    limit: null,
    unit: null,
  };
}

function unifiedPersonalBilling(payload) {
  return typeof payload?.membershipType === 'string' && payload.membershipType.toLowerCase().startsWith('unified_')
    && payload?.limitType?.toLowerCase?.() === 'user';
}

// These endpoints publish ISO dates, not numeric epochs or local wall clocks.
// Refuse unknown timestamps rather than inventing a cycle from 1970 or an
// unzoned date (which would also contaminate pace forecasts).
function quotaDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2020, 0, 1)) return null;
  const zone = /([+-])(\d\d):(\d\d)$/.exec(value);
  const offset = zone ? (zone[1] === '+' ? 1 : -1) * (Number(zone[2]) * 60 + Number(zone[3])) : 0;
  if (zone && (Number(zone[2]) > 23 || Number(zone[3]) > 59)) return null;
  const wall = new Date(timestamp + offset * 60000);
  if (!Number.isFinite(+wall) || wall.toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return new Date(timestamp).toISOString();
}

function sharedWeeklyWindow(payload, now) {
  const hasLimit = typeof payload?.includedLimitZero === 'boolean'
    ? !payload.includedLimitZero : payload?.hasNonZeroIncludedLimit === true;
  const used = numeric(payload?.usagePercent);
  const resetsAt = quotaDate(payload?.nextResetTimestampUtc);
  const startsAt = quotaDate(payload?.currentPeriodStart);
  if (payload?.isUnified !== true || !hasLimit || used == null || used < 0 || !resetsAt || Date.parse(resetsAt) <= +now
    || Date.parse(resetsAt) - +now > 8 * 86400_000
    || payload.currentPeriodStart != null && (!startsAt || Date.parse(startsAt) > +now)) return null;
  return { ...percentWindow('unified-weekly', '共享每周额度 / Shared weekly allowance', used, resetsAt), windowSeconds: 604_800 };
}

function unifiedMonthlyWindow(payload, now) {
  const monthly = payload?.monthlyUsage;
  const used = numeric(monthly?.usedCents);
  const limit = numeric(monthly?.limitCents);
  const start = quotaDate(monthly?.periodStart);
  const end = quotaDate(monthly?.resetsAt);
  if (payload?.availability !== 'available' || used == null || used < 0 || limit == null || limit <= 0
    || used > 1e12 || limit > 1e12 || !start || !end || Date.parse(start) > +now || Date.parse(end) <= +now
    || Date.parse(end) - Date.parse(start) > 62 * 86400_000) return null;
  return { ...creditWindow({ used, limit }, 'on-demand', '按需用量 / Additional usage', end),
    windowSeconds: (Date.parse(end) - Date.parse(start)) / 1000 };
}

export function parseCursorUsage(payload, identity = {}, { now = new Date(), weeklyUsage, monthlyUsage } = {}) {
  const plan = payload?.individualUsage?.plan;
  const overall = payload?.individualUsage?.overall;
  const pooled = payload?.teamUsage?.pooled;
  const resetsAt = asDate(payload?.billingCycleEnd);
  const unified = unifiedPersonalBilling(payload);
  const primary = sharedWeeklyWindow(weeklyUsage, now) || creditWindow(plan, 'plan', '套餐 Credits', resetsAt, {
    percent: numeric(plan?.totalPercentUsed),
  })
    || creditWindow(overall, 'overall', '个人额度', resetsAt)
    || creditWindow(pooled, 'pooled', '团队共享额度', resetsAt);
  const lanes = primary ? [] : [
    percentWindow('plan-auto', 'Auto Credits', plan?.autoPercentUsed, resetsAt),
    percentWindow('plan-api', 'API Credits', plan?.apiPercentUsed, resetsAt),
  ].filter(Boolean);
  const onDemand = (unified && unifiedMonthlyWindow(monthlyUsage, now)) || creditWindow(
    payload?.individualUsage?.onDemand || payload?.teamUsage?.onDemand,
    'on-demand', '按需用量', resetsAt,
  );
  const windows = [primary, ...lanes, onDemand].filter(Boolean);
  return {
    id: 'cursor', label: 'Cursor', status: windows.length ? 'ok' : 'empty',
    account: identity.email || null, plan: payload?.membershipType || null,
    source: identity.source || 'Cursor 登录', updatedAt: now.toISOString(), windows,
    notice: 'Cursor 金额字段按官网账期 Credits 展示；这不是标准 API 账单。',
  };
}

export async function fetchCursorLimits({ settings, environment = process.env, fetcher = fetch, now = new Date() } = {}) {
  let cookie;
  let source;
  if (settings.authMode === 'local') {
    const credentials = loadCursorCredentials(environment);
    if (!credentials.found || !credentials.fresh || !credentials.cookie) {
      const error = new Error(credentials.found
        ? 'Cursor 桌面端登录已过期，请重新登录 Cursor。'
        : '未检测到 Cursor 桌面端登录；也可切换为环境变量或 macOS 钥匙串。');
      error.code = credentials.found ? 'unauthorized' : 'not_configured'; throw error;
    }
    cookie = credentials.cookie; source = 'Cursor 桌面端登录';
  } else {
    cookie = normalizeCookieSecret(resolveProviderSecret('cursor', settings, environment), ['WorkosCursorSessionToken']);
    source = settings.authMode === 'keychain' ? '本工具 macOS 钥匙串' : settings.environmentVariable;
  }
  if (!cookie) {
    const error = new Error('未找到有效 Cursor Session Cookie；可直接粘贴 Cookie 请求头或 cURL 片段。');
    error.code = 'not_configured'; throw error;
  }
  const headers = { Cookie: cookie, 'User-Agent': 'kbu-usage' };
  const [usage, profile, weeklyUsage] = await Promise.all([
    requestJson(USAGE_URL, { headers, fetcher }),
    requestJson(PROFILE_URL, { headers, fetcher, timeoutMs: 4_000 }).catch(() => null),
    requestJson(WEEKLY_URL, { method: 'POST', body: {}, headers: { ...headers,
      Origin: 'https://cursor.com', 'Content-Type': 'application/json' }, fetcher, timeoutMs: 3_000 }).catch(() => null),
  ]);
  // The X subscription's shared pool can appear on Enterprise/team accounts
  // too. Only the optional monthly spend endpoint requires a unified personal
  // plan. Both use the same account; failures never blank valid summary data.
  const monthlyUsage = unifiedPersonalBilling(usage)
    ? await requestJson(MONTHLY_URL, { headers, fetcher, timeoutMs: 3_000 }).catch(() => null) : null;
  return parseCursorUsage(usage, { email: profile?.email, source }, { now, weeklyUsage, monthlyUsage });
}
