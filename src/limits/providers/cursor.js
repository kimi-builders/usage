import {
  loadCursorCredentials, normalizeCookieSecret, resolveProviderSecret,
} from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const USAGE_URL = 'https://cursor.com/api/usage-summary';
const PROFILE_URL = 'https://cursor.com/api/auth/me';

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function creditWindow(value, id, label, resetsAt, { percent } = {}) {
  if (!value || value.enabled === false) return null;
  const usedCents = numeric(value.used) ?? 0;
  const limitCents = numeric(value.limit);
  let usedPercent = asPercent(percent);
  if (usedPercent == null && limitCents != null && limitCents > 0) usedPercent = asPercent(usedCents / limitCents * 100);
  if (usedPercent == null) return null;
  return {
    id, label, usedPercent, remainingPercent: 100 - usedPercent, resetsAt,
    value: usedCents / 100, limit: limitCents == null ? null : limitCents / 100, unit: 'USD',
  };
}

export function parseCursorUsage(payload, identity = {}, { now = new Date() } = {}) {
  const plan = payload?.individualUsage?.plan;
  const overall = payload?.individualUsage?.overall;
  const pooled = payload?.teamUsage?.pooled;
  const lanePercents = [numeric(plan?.autoPercentUsed), numeric(plan?.apiPercentUsed)]
    .filter((value) => value != null);
  const rawPlanPercent = numeric(plan?.totalPercentUsed)
    ?? (lanePercents.length ? lanePercents.reduce((sum, value) => sum + value, 0) / lanePercents.length : null);
  const resetsAt = asDate(payload?.billingCycleEnd);
  const primary = creditWindow(plan, 'plan', '套餐 Credits', resetsAt, { percent: rawPlanPercent })
    || creditWindow(overall, 'overall', '个人额度', resetsAt)
    || creditWindow(pooled, 'pooled', '团队共享额度', resetsAt);
  const onDemand = creditWindow(
    payload?.individualUsage?.onDemand || payload?.teamUsage?.onDemand,
    'on-demand', '按需用量', resetsAt,
  );
  const windows = [primary, onDemand].filter(Boolean);
  return {
    id: 'cursor', label: 'Cursor', status: windows.length ? 'ok' : 'empty',
    account: identity.email || null, plan: payload?.membershipType || null,
    source: identity.source || 'Cursor 登录', updatedAt: now.toISOString(), windows,
    notice: 'Cursor 金额字段按官网账期 Credits 展示；这不是标准 API 账单。',
  };
}

export async function fetchCursorLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
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
  const [usage, profile] = await Promise.all([
    requestJson(USAGE_URL, { headers, fetcher }),
    requestJson(PROFILE_URL, { headers, fetcher, timeoutMs: 4_000 }).catch(() => null),
  ]);
  return parseCursorUsage(usage, { email: profile?.email, source });
}
