import { normalizeCookieSecret, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summary(container) {
  return container?.quotaSummary || container?.quota_summary || null;
}

function quotaValues(value) {
  if (!value) return null;
  const used = number(value.usedValue ?? value.used_value);
  const limit = number(value.limitValue ?? value.limit_value);
  const remaining = number(value.remainingValue ?? value.remaining_value)
    ?? (used != null && limit != null ? Math.max(0, limit - used) : null);
  if (used == null || limit == null || used < 0 || limit < 0 || remaining == null || remaining < 0) return null;
  return { used, limit, remaining, unit: value.unit || 'credits' };
}

export function parseQoderUsage(payload, identity = {}, { now = new Date() } = {}) {
  const primary = quotaValues(summary(payload?.totalQuota || payload?.total_quota));
  const shared = quotaValues(summary(payload?.sharedQuota || payload?.shared_quota));
  if (!primary) {
    const error = new Error('Qoder 返回数据缺少 totalQuota.quotaSummary。');
    error.code = 'invalid_response';
    throw error;
  }
  const used = primary.used + (shared?.used || 0);
  const limit = primary.limit + (shared?.limit || 0);
  const remaining = primary.remaining + (shared?.remaining || 0);
  const usedPercent = asPercent(limit > 0 ? used / limit * 100 : 0);
  return {
    id: 'qoder', label: 'Qoder', status: 'ok', account: identity.account || null,
    plan: null, source: identity.source || 'Qoder Web 登录', updatedAt: now.toISOString(),
    windows: [{
      id: 'credits', label: shared ? '个人 + 共享 Credits' : 'Big Model Credits',
      usedPercent, remainingPercent: 100 - usedPercent,
      resetsAt: asDate(payload?.nextResetAt ?? payload?.next_reset_at),
      value: used, limit, unit: primary.unit,
    }],
    notice: shared ? '已合并个人额度与团队共享额度，避免低估可用 Credits。' : 'Qoder 按账户 Big Model Credits 展示。',
  };
}

export async function fetchQoderLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const cookie = normalizeCookieSecret(resolveProviderSecret('qoder', settings, environment));
  if (!cookie) {
    const error = new Error('未找到 Qoder Session Cookie；可直接粘贴浏览器请求中的 Cookie 或 cURL 片段。');
    error.code = 'not_configured'; throw error;
  }
  const origin = settings.site === 'china' ? 'https://qoder.com.cn' : 'https://qoder.com';
  const payload = await requestJson(`${origin}/api/v2/me/usages/big_model_credits`, {
    headers: {
      Cookie: cookie, Origin: origin, Referer: `${origin}/account/usage`,
      'X-Requested-With': 'XMLHttpRequest', 'Bx-V': '2.5.35',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 kbu-usage',
    }, fetcher,
  });
  return parseQoderUsage(payload, {
    source: settings.authMode === 'keychain' ? '本工具 macOS 钥匙串' : settings.environmentVariable,
  });
}
