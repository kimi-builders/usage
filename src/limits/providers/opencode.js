import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeCookieSecret, resolveProviderSecret } from '../credentials.js';
import { LimitHTTPError, asDate, asPercent, requestJson, requestText } from '../http.js';
import { queryDbJson } from '../../parsers/sqlite.js';
import { openCodeDataRoots } from '../../opencode-roots.js';
export { openCodeDataRoots } from '../../opencode-roots.js';

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

export function parseOpenCodeGoUsage(text, {
  now = new Date(), source = 'OpenCode Go Web 登录', notice,
} = {}) {
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
    notice: notice || '额度来自 OpenCode Go Workspace 订阅；本机 OpenCode Token 用量与该额度分开统计。',
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

// Shared by the manually configured API key and the local-login fallback. The
// key is passed straight into the Authorization header and never copied into
// the result, so it cannot reach the settings cache, history, or output.
async function fetchUsageWithApiKey(key, { source, notice, fetcher }) {
  let payload;
  try {
    payload = await requestJson(`${BASE_URL}/zen/go/v1/usage`, {
      headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'kbu-usage' },
      fetcher,
    });
  } catch (error) {
    // HTTP 403 with an API key means the key itself is accepted but the
    // account has no active Go subscription. Carry the reason machine-
    // readably so a client can render 「未订阅」 instead of a neutral empty
    // state; 401 stays an expired or invalid credential.
    if (!(error instanceof LimitHTTPError) || error.status !== 403) throw error;
    return {
      id: 'opencode', label: 'OpenCode Go', status: 'empty', emptyReason: 'notEntitled',
      account: null, plan: null, source,
      updatedAt: new Date().toISOString(), windows: [],
      notice: 'OpenCode 账户有效，但当前没有生效的 Go 订阅；本机 OpenCode Token 用量仍会正常统计。',
    };
  }
  return parseOpenCodeGoUsage(JSON.stringify(payload), { source, notice });
}

/**
 * The credential table is the authoritative Go store: 2.x keeps an
 * integration-specific row there. Only that row's `value` column is selected
 * through the shared read-only SQLite helper — the query never writes, and
 * nothing but the parsed key leaves this function. A table without the
 * expected schema simply has no login; other read failures stay concrete so
 * the caller can prefer a healthy auth.json login over reporting them.
 */
function readCredentialTable(root) {
  const dbPath = join(root, 'opencode.db');
  if (!existsSync(dbPath)) return { status: 'missing' };
  try {
    const rows = queryDbJson(dbPath, `SELECT value FROM credential
      WHERE integration_id = 'opencode-go'
      ORDER BY coalesce(active, 1) DESC, time_updated DESC
      LIMIT 1`);
    const raw = rows[0]?.value;
    if (typeof raw !== 'string' || !raw.trim()) return { status: 'missing' };
    let key = '';
    try {
      const parsed = JSON.parse(raw);
      key = typeof parsed?.key === 'string' ? parsed.key.trim() : '';
    } catch {
      key = '';
    }
    return key ? { status: 'ok', key } : { status: 'missing' };
  } catch (error) {
    if (/no such table|no such column/i.test(error?.message || '')) return { status: 'missing' };
    return { status: 'error' };
  }
}

/**
 * Fallback for 1.x data directories, which keep the same key as plain JSON in
 * auth.json (`{"opencode": {"type": "api", "key": "sk-…"}}`). Only that one
 * entry is read; sibling provider credentials in the file are never inspected,
 * and the key is returned without ever being logged or cached.
 */
function readAuthFile(root) {
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(join(root, 'auth.json'), 'utf8'));
  } catch {
    return { status: 'missing' };
  }
  const key = parsed?.opencode?.key;
  const trimmed = typeof key === 'string' ? key.trim() : '';
  return trimmed ? { status: 'ok', key: trimmed } : { status: 'missing' };
}

/**
 * The local OpenCode Go login, or why there is none. The credential table
 * wins; auth.json covers stores that never migrated. A concrete table read
 * failure is preserved only when the fallback has no key either, so an
 * unreadable database cannot hide a perfectly good login. The returned key is
 * used for exactly one Authorization header — never persisted, logged, or
 * included in any result.
 */
export function readLocalGoKey(environment = process.env, home = homedir(), platform = process.platform) {
  let found = { status: 'missing' };
  for (const root of openCodeDataRoots(environment, home, platform)) {
    const table = readCredentialTable(root);
    if (table.status === 'ok') return table;
    const authFile = readAuthFile(root);
    if (authFile.status === 'ok') return authFile;
    // Keep the first concrete read failure; a missing store just means the
    // next configured root may hold the login.
    if (table.status === 'error' && found.status !== 'error') found = table;
  }
  return found;
}

export async function fetchOpenCodeGoLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  if (settings.authMode === 'local' && !settings.accountId && !settings.credentialKey
      && !settings.accounts?.length && !settings.workspaceId) {
    const discovered = readLocalGoKey(environment);
    if (discovered.status !== 'ok') {
      throw Object.assign(new Error(discovered.status === 'error'
        ? '无法读取本机 OpenCode 登录存储，请检查本机登录或添加手动账户。'
        : '未找到本机 OpenCode Go 登录，请先登录 OpenCode 或添加手动账户。'), {
        code: discovered.status === 'error' ? 'provider_error' : 'not_configured',
      });
    }
    // Opaque identity prevents history from following a different local login.
    // Never expose the key itself, or reuse a manually named account identity.
    const accountId = `local_${createHash('sha256').update(`opencode-go:${discovered.key}`).digest('hex').slice(0, 32)}`;
    try {
      const result = await fetchUsageWithApiKey(discovered.key, {
        source: 'OpenCode 本机登录',
        notice: '额度来自 OpenCode Go 官方 API（只读复用本机 OpenCode 登录，不回写、不保存凭据）；本机 OpenCode Token 用量与该额度分开统计。',
        fetcher,
      });
      return { ...result, accountId };
    } catch (error) {
      error.accountId = accountId;
      throw error;
    }
  }
  const secret = resolveProviderSecret('opencode', settings, environment);
  const apiKeyMode = settings.connectionType === 'api-key';
  if (apiKeyMode) {
    // An explicitly configured API-key account keeps its failure semantics:
    // a missing secret is a configuration error, not a reason to silently
    // read a different credential source.
    if (!secret) {
      const error = new Error('未找到 OpenCode Go API Key。');
      error.code = 'not_configured';
      throw error;
    }
    return fetchUsageWithApiKey(secret, {
      source: settings.accountLabel ? `OpenCode Go API Key · ${settings.accountLabel}` : 'OpenCode Go API Key',
      notice: '额度来自 OpenCode Go 官方 API；本机 OpenCode Token 用量与该额度分开统计。',
      fetcher,
    });
  }
  const cookie = normalizeCookieSecret(secret, ['auth', '__Host-auth']);
  if (cookie) {
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
  const error = new Error('未找到此 OpenCode Go 账户的 Cookie；请补齐该账户凭据，或明确选择本机登录模式。');
  error.code = 'not_configured';
  throw error;
}

export const fetchOpenCodeLimits = fetchOpenCodeGoLimits;
