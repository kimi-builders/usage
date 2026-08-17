import { normalizeCookieSecret, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestText } from '../http.js';

const BASE_URL = 'https://opencode.ai';

const PERCENT_KEYS = [
  'usagePercent', 'usedPercent', 'percentUsed', 'percent', 'usage_percent', 'used_percent',
  'utilization', 'utilizationPercent', 'utilization_percent', 'usage',
];
const RESET_SECONDS_KEYS = [
  'resetInSec', 'resetInSeconds', 'resetSeconds', 'reset_sec', 'reset_in_sec',
  'resetsInSec', 'resetsInSeconds', 'resetIn', 'resetSec',
];
const RESET_AT_KEYS = [
  'resetAt', 'resetsAt', 'reset_at', 'resets_at', 'nextReset', 'next_reset', 'renewAt', 'renew_at',
];
const USED_KEYS = ['used', 'consumed', 'count', 'usedTokens'];
const LIMIT_KEYS = ['limit', 'total', 'quota', 'max', 'cap', 'tokenLimit'];

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function first(object, keys) {
  for (const key of keys) if (object?.[key] != null) return object[key];
  return null;
}

function resetAt(object, now) {
  const absolute = asDate(first(object, RESET_AT_KEYS));
  if (absolute) return absolute;
  const seconds = number(first(object, RESET_SECONDS_KEYS));
  return seconds != null ? new Date(now.valueOf() + Math.max(0, seconds) * 1_000).toISOString() : null;
}

function usagePercent(object) {
  const direct = number(first(object, PERCENT_KEYS));
  if (direct != null) {
    // OpenCode Go has emitted both fractions (0…1) and percentages (0…100).
    return asPercent(direct >= 0 && direct <= 1 ? direct * 100 : direct);
  }
  const used = number(first(object, USED_KEYS));
  const limit = number(first(object, LIMIT_KEYS));
  return used != null && limit != null && limit > 0 ? asPercent(used / limit * 100) : null;
}

function locate(object, names) {
  if (!object || typeof object !== 'object') return null;
  if (!Array.isArray(object)) {
    for (const name of names) if (object[name] && typeof object[name] === 'object') return object[name];
    for (const value of Object.values(object)) {
      const match = locate(value, names);
      if (match) return match;
    }
  } else {
    for (const value of object) {
      const match = locate(value, names);
      if (match) return match;
    }
  }
  return null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function regexWindow(text, prefix, now) {
  const section = String(text || '').match(new RegExp(`${prefix}[^}]*}`, 'i'))?.[0] || '';
  const percent = number(section.match(/(?:usagePercent|usedPercent|percentUsed|usage_percent)(?:\\?["'])?\s*[:=]\s*([0-9.]+)/i)?.[1]);
  const seconds = number(section.match(/(?:resetInSec|resetInSeconds|reset_in_sec)(?:\\?["'])?\s*[:=]\s*([0-9]+)/i)?.[1]);
  return percent == null ? null : {
    percent: asPercent(percent >= 0 && percent <= 1 ? percent * 100 : percent),
    resetsAt: seconds == null ? null : new Date(now.valueOf() + seconds * 1_000).toISOString(),
  };
}

function normalizedWindow(object, fallback, now) {
  if (object) return { percent: usagePercent(object), resetsAt: resetAt(object, now) };
  return fallback;
}

export function parseOpenCodeGoUsage(text, { now = new Date(), source = 'OpenCode Go Web 登录' } = {}) {
  const object = parseJson(text);
  const rolling = normalizedWindow(locate(object, [
    'rollingUsage', 'rolling_usage', 'rolling', 'rollingWindow', 'rolling_window',
    'sessionUsage', 'fiveHourUsage',
  ]), regexWindow(text, 'rollingUsage', now), now);
  const weekly = normalizedWindow(locate(object, [
    'weeklyUsage', 'weekly_usage', 'weekly', 'weeklyWindow', 'weekly_window', 'sevenDayUsage',
  ]), regexWindow(text, 'weeklyUsage', now), now);
  const monthly = normalizedWindow(locate(object, [
    'monthlyUsage', 'monthly_usage', 'monthly', 'monthlyWindow', 'monthly_window',
  ]), regexWindow(text, 'monthlyUsage', now), now);
  const windows = [
    rolling?.percent != null ? {
      id: 'rolling', label: '5 小时滚动', usedPercent: asPercent(rolling.percent),
      remainingPercent: 100 - asPercent(rolling.percent), resetsAt: rolling.resetsAt, windowSeconds: 18_000,
    } : null,
    weekly?.percent != null ? {
      id: 'weekly', label: '每周', usedPercent: asPercent(weekly.percent),
      remainingPercent: 100 - asPercent(weekly.percent), resetsAt: weekly.resetsAt, windowSeconds: 604_800,
    } : null,
    monthly?.percent != null ? {
      id: 'monthly', label: '每月', usedPercent: asPercent(monthly.percent),
      remainingPercent: 100 - asPercent(monthly.percent), resetsAt: monthly.resetsAt,
    } : null,
  ].filter(Boolean);
  if (!windows.length) {
    const error = new Error('OpenCode Go 返回数据中没有可识别的订阅额度。');
    error.code = 'invalid_response';
    throw error;
  }
  return {
    id: 'opencode', label: 'OpenCode Go', status: 'ok', account: null, plan: null,
    source, updatedAt: now.toISOString(), windows,
    notice: '额度来自 OpenCode Go Workspace 订阅；本机 OpenCode Token 用量与该额度分开统计。',
  };
}

// Keep the old export name for fixture and downstream compatibility while the
// provider label and network implementation now accurately target OpenCode Go.
export const parseOpenCodeUsage = parseOpenCodeGoUsage;

function workspaceId(value) {
  const match = String(value || '').match(/wrk_[A-Za-z0-9_-]+/);
  return match?.[0] || null;
}

function looksSignedOut(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('auth/authorize')
    || lower.includes('not associated with an account')
    || lower.includes('actor of type "public"');
}

async function fetchUsagePage(workspace, cookie, fetcher) {
  const url = `${BASE_URL}/workspace/${workspace}/go`;
  const text = await requestText(url, {
    headers: {
      Cookie: cookie,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/143 Safari/537.36',
    },
    fetcher,
  });
  if (looksSignedOut(text)) {
    const error = new Error('OpenCode Go Cookie 已失效，请重新复制登录会话。');
    error.code = 'unauthorized';
    throw error;
  }
  return text;
}

export async function fetchOpenCodeGoLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const cookie = normalizeCookieSecret(
    resolveProviderSecret('opencode', settings, environment),
    ['auth', '__Host-auth'],
  );
  if (!cookie) {
    const error = new Error('未找到 OpenCode Go auth Cookie；登录 opencode.ai 后，可粘贴 Cookie 请求头或 cURL 片段。');
    error.code = 'not_configured';
    throw error;
  }
  const workspace = workspaceId(settings.workspaceId);
  if (!workspace) {
    const error = new Error('未配置 OpenCode Go Workspace ID；每个账户都需要与 Cookie 配套的 wrk_… ID。');
    error.code = 'not_configured';
    throw error;
  }
  const text = await fetchUsagePage(workspace, cookie, fetcher);
  const source = settings.authMode === 'keychain'
    ? (settings.accountLabel ? `OpenCode Go 账户 · ${settings.accountLabel}` : '本工具 macOS 钥匙串')
    : settings.environmentVariable;
  try {
    return parseOpenCodeGoUsage(text, { source });
  } catch (error) {
    if (error?.code !== 'invalid_response') throw error;
    const unavailable = new Error('OpenCode Go 页面没有返回可验证的订阅窗口；请确认该 Workspace 已开通 Go。');
    unavailable.code = 'workspace_unavailable';
    throw unavailable;
  }
}

export const fetchOpenCodeLimits = fetchOpenCodeGoLimits;
