import { resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';
import { ensureFreshKimiCredentials, kimiIdentityHeaders } from './kimi-oauth.js';
import { createHmac, randomBytes } from 'node:crypto';

const ephemeralIdentitySalt = randomBytes(32).toString('hex');

// Public responses/history use opaque installation-scoped identities, never
// raw account IDs or key prefixes. Unknown ownership cannot join another key.
function kimiIdentity(payload, token, identitySalt, { claims = {}, apiKey = false } = {}) {
  const rawId = payload?.user?.id;
  const owner = typeof rawId === 'string' && rawId.trim() && rawId.length <= 512 ? rawId.trim()
    : Number.isSafeInteger(rawId) && rawId > 0 ? String(rawId) : null;
  const subject = typeof claims.sub === 'string' && claims.sub.trim() && claims.sub.length <= 512 ? claims.sub.trim() : null;
  const hash = value => createHmac('sha256', identitySalt || ephemeralIdentitySalt).update(value).digest('hex').slice(0, 32);
  return { historyAccountId: `kimi_${hash(owner ? `owner:${owner}` : subject ? `oauth-sub:${subject}` : `credential:${token}`)}`,
    accountIdentityVerified: Boolean(owner),
    ...(apiKey ? { credentialId: `key_${hash(`api-key:${token}`)}` } : {}) };
}

const CODE_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';
const WEB_USAGE_URL = 'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages';
const SUBSCRIPTION_URL = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats';
const PLAN_URL = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscription';

function kimiCodePlan(payload) {
  const level = typeof payload?.user?.membership?.level === 'string'
    ? payload.user.membership.level.trim()
    : '';
  if (!level || level === 'LEVEL_UNSPECIFIED') return null;
  // These names belong to the official V1 goods catalog. Unknown versions or
  // future levels remain visible as raw provider facts instead of being guessed.
  const version = payload?.version;
  if (version != null && version !== 'GOODS_VERSION_V1') return level;
  return {
    LEVEL_FREE: 'Adagio',
    LEVEL_TRIAL: 'Andante',
    LEVEL_BASIC: 'Moderato',
    LEVEL_INTERMEDIATE: 'Allegretto',
    LEVEL_ADVANCED: 'Allegro',
  }[level] || level;
}

function kimiWebPlan(payload) {
  const subscription = payload?.subscription;
  const title = typeof subscription?.goods?.title === 'string'
    ? subscription.goods.title.trim()
    : '';
  return subscription?.active === true
    && subscription?.status === 'SUBSCRIPTION_STATUS_ACTIVE'
    && title ? title : null;
}

function quotaNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function detailWindow(detail, { id, label, windowSeconds = null } = {}) {
  if (!detail || typeof detail !== 'object') return null;
  const limit = quotaNumber(detail.limit);
  const used = quotaNumber(detail.used);
  const remaining = quotaNumber(detail.remaining);
  if (limit == null || limit <= 0) return null;
  const actualUsed = used ?? (remaining != null && remaining <= limit ? limit - remaining : null);
  if (actualUsed == null) return null;
  const usedPercent = asPercent(actualUsed / limit * 100);
  return {
    id,
    label,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: asDate(detail.resetTime ?? detail.reset_at ?? detail.reset_time ?? detail.resetAt),
    value: actualUsed,
    limit,
    unit: 'requests',
    windowSeconds,
  };
}

function durationSeconds(window) {
  const duration = Number(window?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const multiplier = {
    TIME_UNIT_MINUTE: 60,
    TIME_UNIT_HOUR: 3_600,
    TIME_UNIT_DAY: 86_400,
  }[window?.timeUnit];
  return multiplier ? duration * multiplier : null;
}

// The 2.x CLI answers with a keyed usages map instead of the legacy
// limits/usage arrays: one entry per quota window carrying a used_ratio.
const USAGES_WINDOWS = [
  ['limit_5h', 'session', '5 小时滚动（5H 频限）', 5 * 3_600],
  ['limit_7d', 'weekly', '每周', 7 * 86_400],
  ['limit_month_total', 'month-total', '本月总额度', null],
  ['limit_month_code', 'month-code', '本月代码额度', null],
];

function usageResetAt(entry, now) {
  const absolute = asDate(entry.resetTime ?? entry.reset_at ?? entry.reset_time ?? entry.resetAt);
  if (absolute) return absolute;
  const seconds = Number(entry.reset_in ?? entry.resetIn ?? entry.ttl);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(now.getTime() + seconds * 1_000).toISOString()
    : null;
}

function usagesWindows(usages, now) {
  if (!usages || typeof usages !== 'object' || Array.isArray(usages)) return [];
  return USAGES_WINDOWS.map(([key, id, label, windowSeconds]) => {
    const entry = usages[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const ratio = quotaNumber(entry.used_ratio ?? entry.usedRatio);
    if (ratio == null) return null;
    const usedPercent = asPercent(ratio * 100);
    return {
      id, label, usedPercent, remainingPercent: 100 - usedPercent,
      resetsAt: usageResetAt(entry, now), windowSeconds,
    };
  }).filter(Boolean);
}

export function parseKimiCodeUsage(payload, { now = new Date(), source = '~/.kimi-code/credentials/kimi-code.json' } = {}) {
  const firstLimit = Array.isArray(payload?.limits)
    ? payload.limits.find(limit => durationSeconds(limit?.window) === 18_000) : null;
  const windows = [
    ...usagesWindows(payload?.usages, now),
    detailWindow(firstLimit?.detail, {
      id: 'session', label: '5 小时滚动（5H 频限）', windowSeconds: durationSeconds(firstLimit?.window),
    }),
    detailWindow(payload?.usage, { id: 'weekly', label: '每周' }),
  ].filter(Boolean);
  // Prefer the ratio shape, except when reliable counters for the SAME cycle
  // report more consumption. Kimi's reset clocks can differ by up to 2s.
  // The Code API's legacy `usage` is its weekly counter; monthly pools never
  // borrow that counter or acquire an invented fixed duration.
  const unique = new Map();
  for (const window of windows) {
    const ratio = unique.get(window.id);
    if (!ratio) { unique.set(window.id, window); continue; }
    const seconds = window.id === 'weekly' ? 604_800 : window.windowSeconds;
    if (seconds && seconds === ratio.windowSeconds && ratio.resetsAt && window.resetsAt
      && Math.abs(Date.parse(ratio.resetsAt) - Date.parse(window.resetsAt)) <= 2_000
      && window.usedPercent > ratio.usedPercent) {
      unique.set(window.id, { ...window, windowSeconds: ratio.windowSeconds });
    }
  }
  const uniqueWindows = [...unique.values()];
  return {
    id: 'kimi-code', label: 'Kimi Code', status: uniqueWindows.length ? 'ok' : 'empty',
    account: null, plan: kimiCodePlan(payload), source, updatedAt: now.toISOString(), windows: uniqueWindows,
    notice: 'Kimi Code 账户额度由该账户的设备和 API Key 共享；只显示接口返回的窗口，未返回周额度不代表查询失败。',
  };
}

export function parseKimiWebUsage(usagePayload, subscriptionPayload, {
  now = new Date(), claims = {}, planPayload = null,
} = {}) {
  const coding = Array.isArray(usagePayload?.usages)
    ? usagePayload.usages.find((item) => item?.scope === 'FEATURE_CODING')
    : null;
  const firstLimit = Array.isArray(coding?.limits) ? coding.limits[0] : null;
  const balance = subscriptionPayload?.subscriptionBalance;
  const code7d = subscriptionPayload?.ratelimitCode7d;
  const totalRatio = quotaNumber(balance?.amountUsedRatio);
  const weeklyRatio = quotaNumber(code7d?.ratio);
  const windows = [
    detailWindow(firstLimit?.detail, {
      id: 'session', label: '5 小时滚动（5H 频限）', windowSeconds: durationSeconds(firstLimit?.window),
    }),
    detailWindow(coding?.detail, { id: 'weekly', label: '每周' }),
    weeklyRatio != null ? {
      id: 'code-weekly', label: 'Code 每周', usedPercent: asPercent(weeklyRatio * 100),
      remainingPercent: 100 - asPercent(weeklyRatio * 100), resetsAt: asDate(code7d?.resetTime),
    } : null,
    totalRatio != null ? {
      id: 'total', label: '订阅总额度', usedPercent: asPercent(totalRatio * 100),
      remainingPercent: 100 - asPercent(totalRatio * 100), resetsAt: asDate(balance?.expireTime),
    } : null,
  ].filter(Boolean);
  return {
    id: 'kimi-code', label: 'Kimi Code', status: windows.length ? 'ok' : 'empty',
    account: claims.email || null, plan: kimiWebPlan(planPayload) || claims.plan || null, source: 'Kimi Web 登录令牌',
    updatedAt: now.toISOString(), windows, notice: '额度来自 Kimi 账户接口，按请求/订阅窗口展示。',
  };
}

function webHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Cookie: `kimi-auth=${token}`,
    'Content-Type': 'application/json',
    Origin: 'https://www.kimi.com',
    Referer: 'https://www.kimi.com/code/console',
    'User-Agent': 'kbu-usage',
    'connect-protocol-version': '1',
    'x-msh-platform': 'web',
  };
}

export async function fetchKimiLimits({ settings, environment = process.env, fetcher = fetch, identitySalt } = {}) {
  if (settings.authMode === 'local') {
    let credential = await ensureFreshKimiCredentials({ environment, fetcher });
    if (!credential.found || !credential.fresh) {
      const error = new Error(credential.found
        ? 'Kimi Code 登录已过期且无法自动续期。运行 kimi 重新登录后，下次查询会自动重读新凭据，无需重启；'
          + '无人值守可在额度设置中添加独立的 Kimi for Coding API Key 账户，使用环境变量或钥匙串。'
        : '未找到 Kimi Code 登录。请运行 kimi 并完成登录，下次查询会自动读取；'
          + '也可在额度设置中添加独立的 Kimi for Coding API Key 账户，使用环境变量或钥匙串。');
      error.code = credential.found ? 'unauthorized' : 'not_configured';
      throw error;
    }
    const readUsage = (value) => requestJson(CODE_USAGE_URL, {
      headers: {
        ...kimiIdentityHeaders(value),
        Authorization: `Bearer ${value.accessToken}`,
      },
      fetcher,
    });
    let payload;
    try {
      payload = await readUsage(credential);
    } catch (error) {
      if (error?.code !== 'unauthorized') throw error;
      const rejectedAccessToken = credential.accessToken;
      credential = await ensureFreshKimiCredentials({ environment, fetcher, force: true });
      if (!credential.fresh || credential.accessToken === rejectedAccessToken) throw error;
      payload = await readUsage(credential);
    }
    return { ...parseKimiCodeUsage(payload), ...kimiIdentity(payload, credential.accessToken, identitySalt, { claims: credential.claims }) };
  }
  const token = resolveProviderSecret('kimi-code', settings, environment);
  if (!token) {
    const error = new Error('未找到 Kimi 凭据。请检查环境变量或 macOS 钥匙串。');
    error.code = 'not_configured';
    throw error;
  }
  if (settings.connectionType === 'api-key') {
    // API keys never go to the website, refresh endpoint or another account.
    const payload = await requestJson(CODE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'kbu-usage' }, fetcher,
    });
    return { ...parseKimiCodeUsage(payload, { source: 'Kimi for Coding API Key' }),
      ...kimiIdentity(payload, token, identitySalt, { apiKey: true }) };
  }
  const headers = webHeaders(token);
  const [usage, subscription, plan] = await Promise.all([
    requestJson(WEB_USAGE_URL, {
      method: 'POST', headers, body: { scope: ['FEATURE_CODING'] }, fetcher,
    }),
    requestJson(SUBSCRIPTION_URL, {
      method: 'POST', headers, body: {}, fetcher, timeoutMs: 2_000,
    }).catch(() => null),
    requestJson(PLAN_URL, {
      method: 'POST', headers, body: {}, fetcher, timeoutMs: 2_000,
    }).catch(() => null),
  ]);
  return { ...parseKimiWebUsage(usage, subscription, { claims: {}, planPayload: plan }),
    ...kimiIdentity(usage, token, identitySalt) };
}
