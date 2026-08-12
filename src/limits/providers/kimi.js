import { loadKimiCredentials, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const CODE_USAGE_URL = 'https://api.kimi.com/coding/v1/usages';
const WEB_USAGE_URL = 'https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages';
const SUBSCRIPTION_URL = 'https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats';

function detailWindow(detail, { id, label, windowSeconds = null } = {}) {
  if (!detail || typeof detail !== 'object') return null;
  const limit = Number(detail.limit);
  const used = Number(detail.used);
  const remaining = Number(detail.remaining);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const actualUsed = Number.isFinite(used) ? used : Number.isFinite(remaining) ? limit - remaining : null;
  if (!Number.isFinite(actualUsed)) return null;
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

export function parseKimiCodeUsage(payload, { now = new Date(), source = '~/.kimi-code/credentials/kimi-code.json' } = {}) {
  const firstLimit = Array.isArray(payload?.limits) ? payload.limits[0] : null;
  const windows = [
    detailWindow(firstLimit?.detail, {
      id: 'session', label: '短周期', windowSeconds: durationSeconds(firstLimit?.window),
    }),
    detailWindow(payload?.usage, { id: 'weekly', label: '7 天' }),
  ].filter(Boolean);
  return {
    id: 'kimi-code', label: 'Kimi Code', status: windows.length ? 'ok' : 'empty',
    account: null, plan: null, source, updatedAt: now.toISOString(), windows,
    notice: 'Kimi Code 本机登录可读取短周期与 7 天额度；订阅总额度需要 Kimi Web 登录令牌。',
  };
}

export function parseKimiWebUsage(usagePayload, subscriptionPayload, { now = new Date(), claims = {} } = {}) {
  const coding = Array.isArray(usagePayload?.usages)
    ? usagePayload.usages.find((item) => item?.scope === 'FEATURE_CODING')
    : null;
  const firstLimit = Array.isArray(coding?.limits) ? coding.limits[0] : null;
  const balance = subscriptionPayload?.subscriptionBalance;
  const code7d = subscriptionPayload?.ratelimitCode7d;
  const totalRatio = Number(balance?.amountUsedRatio);
  const weeklyRatio = Number(code7d?.ratio);
  const windows = [
    detailWindow(firstLimit?.detail, {
      id: 'session', label: '5 小时', windowSeconds: durationSeconds(firstLimit?.window),
    }),
    detailWindow(coding?.detail, { id: 'weekly', label: '7 天' }),
    Number.isFinite(weeklyRatio) ? {
      id: 'code-weekly', label: 'Code 7 天', usedPercent: asPercent(weeklyRatio * 100),
      remainingPercent: 100 - asPercent(weeklyRatio * 100), resetsAt: asDate(code7d?.resetTime),
    } : null,
    Number.isFinite(totalRatio) ? {
      id: 'total', label: '订阅总额度', usedPercent: asPercent(totalRatio * 100),
      remainingPercent: 100 - asPercent(totalRatio * 100), resetsAt: asDate(balance?.expireTime),
    } : null,
  ].filter(Boolean);
  return {
    id: 'kimi-code', label: 'Kimi Code', status: windows.length ? 'ok' : 'empty',
    account: claims.email || null, plan: claims.plan || null, source: 'Kimi Web 登录令牌',
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

export async function fetchKimiLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  if (settings.authMode === 'local') {
    const credential = loadKimiCredentials(environment);
    if (!credential.found || !credential.fresh) {
      const error = new Error(credential.found
        ? 'Kimi Code 登录已过期，请重新运行 kimi 登录。'
        : '未找到 Kimi Code 登录；也可在额度设置中使用环境变量或钥匙串。');
      error.code = credential.found ? 'unauthorized' : 'not_configured';
      throw error;
    }
    const payload = await requestJson(CODE_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'User-Agent': 'kbu-usage',
        'X-Msh-Platform': 'kimi_code_cli',
        'X-Msh-Version': '0.3',
      },
      fetcher,
    });
    return parseKimiCodeUsage(payload);
  }
  const token = resolveProviderSecret('kimi-code', settings, environment);
  if (!token) {
    const error = new Error('未找到 Kimi 凭据。请检查环境变量或 macOS 钥匙串。');
    error.code = 'not_configured';
    throw error;
  }
  const headers = webHeaders(token);
  const [usage, subscription] = await Promise.all([
    requestJson(WEB_USAGE_URL, {
      method: 'POST', headers, body: { scope: ['FEATURE_CODING'] }, fetcher,
    }),
    requestJson(SUBSCRIPTION_URL, {
      method: 'POST', headers, body: {}, fetcher,
    }).catch(() => null),
  ]);
  return parseKimiWebUsage(usage, subscription, { claims: {} });
}
