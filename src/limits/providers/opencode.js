import { randomUUID } from 'node:crypto';
import { normalizeCookieSecret, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestText } from '../http.js';

const SERVER_URL = 'https://opencode.ai/_server';
const WORKSPACES_ID = 'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f';
const SUBSCRIPTION_ID = '7abeebee372f304e050aaaf92be863f4a86490e382f8c79db68fd94040d691b4';

const PERCENT_KEYS = ['usagePercent', 'usedPercent', 'percentUsed', 'percent', 'usage_percent', 'used_percent', 'utilization'];
const RESET_SECONDS_KEYS = ['resetInSec', 'resetInSeconds', 'resetSeconds', 'reset_in_sec', 'resetsInSec', 'resetSec'];
const RESET_AT_KEYS = ['resetAt', 'resetsAt', 'reset_at', 'nextReset', 'renewAt', 'renew_at'];

function number(value) {
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

function locate(object, names) {
  if (!object || typeof object !== 'object') return null;
  if (!Array.isArray(object)) {
    for (const name of names) if (object[name] && typeof object[name] === 'object') return object[name];
    for (const value of Object.values(object)) {
      const match = locate(value, names); if (match) return match;
    }
  } else {
    for (const value of object) { const match = locate(value, names); if (match) return match; }
  }
  return null;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function regexWindow(text, prefix, now) {
  const section = text.match(new RegExp(`${prefix}[^}]*}`, 'i'))?.[0] || '';
  const percent = number(section.match(/(?:usagePercent|usedPercent|percentUsed|usage_percent)\s*[:=]\s*([0-9.]+)/i)?.[1]);
  const seconds = number(section.match(/(?:resetInSec|resetInSeconds|reset_in_sec)\s*[:=]\s*([0-9]+)/i)?.[1]);
  return percent == null ? null : { percent, resetsAt: seconds == null ? null : new Date(now.valueOf() + seconds * 1_000).toISOString() };
}

export function parseOpenCodeUsage(text, { now = new Date(), source = 'OpenCode Web 登录' } = {}) {
  const object = parseJson(text);
  const rollingObject = locate(object, ['rollingUsage', 'rolling_usage', 'sessionUsage', 'fiveHourUsage']);
  const weeklyObject = locate(object, ['weeklyUsage', 'weekly_usage', 'sevenDayUsage']);
  const rolling = rollingObject ? { percent: number(first(rollingObject, PERCENT_KEYS)), resetsAt: resetAt(rollingObject, now) } : regexWindow(text, 'rollingUsage', now);
  const weekly = weeklyObject ? { percent: number(first(weeklyObject, PERCENT_KEYS)), resetsAt: resetAt(weeklyObject, now) } : regexWindow(text, 'weeklyUsage', now);
  const windows = [
    rolling?.percent != null ? { id: 'rolling', label: '5 小时滚动', usedPercent: asPercent(rolling.percent), remainingPercent: 100 - asPercent(rolling.percent), resetsAt: rolling.resetsAt, windowSeconds: 18_000 } : null,
    weekly?.percent != null ? { id: 'weekly', label: '每周', usedPercent: asPercent(weekly.percent), remainingPercent: 100 - asPercent(weekly.percent), resetsAt: weekly.resetsAt, windowSeconds: 604_800 } : null,
  ].filter(Boolean);
  if (!windows.length) {
    const error = new Error('OpenCode 返回数据中没有可识别的订阅额度。'); error.code = 'invalid_response'; throw error;
  }
  return {
    id: 'opencode', label: 'OpenCode', status: 'ok', account: null, plan: null,
    source, updatedAt: now.toISOString(), windows,
    notice: '额度来自 OpenCode Workspace 订阅；本地 Token 用量与该额度分开统计。',
  };
}

function serverHeaders(id, cookie, referer) {
  return {
    Cookie: cookie, 'X-Server-Id': id, 'X-Server-Instance': `server-fn:${randomUUID()}`,
    Origin: 'https://opencode.ai', Referer: referer,
    Accept: 'text/javascript, application/json;q=0.9, */*;q=0.8',
    'User-Agent': 'Mozilla/5.0 kbu-usage',
  };
}

async function serverRequest(id, args, cookie, referer, fetcher, method = 'GET') {
  const url = new URL(SERVER_URL);
  if (method === 'GET') {
    url.searchParams.set('id', id);
    if (args?.length) url.searchParams.set('args', JSON.stringify(args));
  }
  const headers = serverHeaders(id, cookie, referer);
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  return requestText(url, {
    method, headers, body: method === 'GET' ? undefined : (args || []), fetcher,
  });
}

function workspaceId(value) {
  const match = String(value || '').match(/wrk_[A-Za-z0-9_-]+/);
  return match?.[0] || null;
}

export async function fetchOpenCodeLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const cookie = normalizeCookieSecret(resolveProviderSecret('opencode', settings, environment), ['auth', '__Host-auth']);
  if (!cookie) {
    const error = new Error('未找到 OpenCode auth Cookie；登录 opencode.ai 后，可粘贴 Cookie 请求头或 cURL 片段。');
    error.code = 'not_configured'; throw error;
  }
  let workspace = workspaceId(settings.workspaceId);
  if (!workspace) {
    const text = await serverRequest(WORKSPACES_ID, null, cookie, 'https://opencode.ai', fetcher);
    workspace = workspaceId(text);
    if (!workspace) {
      const fallback = await serverRequest(WORKSPACES_ID, [], cookie, 'https://opencode.ai', fetcher, 'POST');
      workspace = workspaceId(fallback);
    }
  }
  if (!workspace) {
    const error = new Error('已连接 OpenCode，但无法确定 Workspace。请粘贴 Workspace 账单页链接。');
    error.code = 'not_configured'; throw error;
  }
  const referer = `https://opencode.ai/workspace/${workspace}/billing`;
  let text = await serverRequest(SUBSCRIPTION_ID, [workspace], cookie, referer, fetcher);
  const source = settings.authMode === 'keychain' ? '本工具 macOS 钥匙串' : settings.environmentVariable;
  try {
    return parseOpenCodeUsage(text, { source });
  } catch (error) {
    if (error?.code !== 'invalid_response' || text.trim().toLowerCase() === 'null') throw error;
    text = await serverRequest(SUBSCRIPTION_ID, [workspace], cookie, referer, fetcher, 'POST');
    return parseOpenCodeUsage(text, { source });
  }
}
