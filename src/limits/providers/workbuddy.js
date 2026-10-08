import { resolveProviderSecret } from '../credentials.js';
import { requestJson } from '../http.js';
import { withPlanAccount } from './coding-plan-common.js';

const ORIGIN = 'https://www.workbuddy.cn';
const PAID = ['002_AkiJS3ZHF5', '005_maRGyrHhw1', '003_FAnt7lcmRT', '023_4xbGhMrE6q', '026_BaESVICNoi', '027_0FCGVA6vSa', '009_0XmEQc2xOf', '038_OhvqZtiPKr', '036_lupO5WgNdG'];
const FREE = ['001_PqouKr6QWV', '008_cfWoLwvjU4', '035_ArVxJcGDsm', '006_DbXS0lrypC', '039_KRcQj7wUat', '040_mi9rCYg46x', '007_nzdH5h4Nl0', '028_NtpWi0jzXs', '037_WxOD3MpI2o', '029_6wCGEWquYy', '030_BjSt89qTvr'];
const invalid = () => Object.assign(new Error('WorkBuddy 返回了无法验证的 Credits 数据。'), { code: 'invalid_response' });
const amount = value => typeof value === 'number' || typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)
  ? Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12 ? Number(value) : null : null;

// One explicit credential tuple, never browser-cookie discovery or desktop decryption.
export function parseWorkBuddyCredential(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { /* generic, secret-free error below */ }
  const valid = key => typeof value?.[key] === 'string' && value[key].trim()
    && value[key].length <= (key === 'cookie' ? 32_768 : 1_024) && !/[\r\n\0]/.test(value[key]);
  if (!valid('cookie') || !valid('userAgent')) {
    throw Object.assign(new Error('WorkBuddy 需要同一浏览器请求中的 Cookie 和 User-Agent。'), { code: 'not_configured' });
  }
  return { cookie: value.cookie.trim(), userAgent: value.userAgent.trim() };
}

export function parseWorkBuddyUsage(payload, { now = new Date(), resetsAt = null } = {}) {
  if (payload?.code !== 0 || !Array.isArray(payload?.data?.Packages) || payload.data.Packages.length > 200) throw invalid();
  let total = 0; let remaining = 0; let reserved = 0; let count = 0; let reservedKnown = true;
  for (const item of payload.data.Packages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid();
    if (item?.CapacityUnit !== 'credits') continue;
    const capacity = amount(item.CycleTotalCapacity);
    const left = amount(item.CycleRemainCapacity);
    const frozen = item.CycleFrozenCapacity == null ? null : amount(item.CycleFrozenCapacity);
    if (capacity == null || left == null || item.CycleFrozenCapacity != null && frozen == null) throw invalid();
    total += capacity; remaining += left; reserved += frozen || 0; count += 1;
    reservedKnown &&= frozen != null;
    if ([total, remaining, reserved].some(value => value > 1e12)) throw invalid();
  }
  const used = Math.max(0, total - remaining);
  const usedPercent = total > 0 ? Math.min(100, used / total * 100) : null;
  return {
    id: 'workbuddy', label: 'WorkBuddy', status: count ? 'ok' : 'empty',
    source: 'WorkBuddy website', updatedAt: now.toISOString(),
    plan: typeof payload.data.SubscriptionPackageName === 'string' ? payload.data.SubscriptionPackageName.trim().slice(0, 160) : null,
    creditBalance: count ? { total, remaining, reserved: reservedKnown ? reserved : null, resetsAt } : null,
    windows: usedPercent == null ? [] : [{ id: 'monthly-credits', label: '每月 Credits',
      value: used, limit: total, unit: 'credits', usedPercent, remainingPercent: 100 - usedPercent,
      resetsAt, windowSeconds: null }],
    notice: 'WorkBuddy 官方 Credits；预留数不重复扣减，Credits 不等于 Token，也不会自动归属本机账号用量。',
  };
}

export function workBuddyReset(payload, now = new Date()) {
  if (payload?.code !== 0 || !Array.isArray(payload?.data?.Accounts) || payload.data.Accounts.length > 100) return null;
  return payload.data.Accounts.filter(item => item?.CapacityUnit === 'credits').map(item => {
    const raw = item.CycleEndTime;
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
    const local = raw.replace(' ', 'T');
    const date = new Date(`${local}+08:00`);
    // Validate calendar/time fields, then move from inclusive end to reset instant.
    if (!Number.isFinite(+date) || new Date(+date + 8 * 3600_000).toISOString().slice(0, 19) !== local) return null;
    return +date + 1_000 > +now ? new Date(+date + 1_000).toISOString() : null;
  }).filter(Boolean).sort()[0] || null;
}

export async function fetchWorkBuddyLimits({ settings, environment = process.env, fetcher = fetch, now = new Date() } = {}) {
  const { cookie, userAgent } = parseWorkBuddyCredential(resolveProviderSecret('workbuddy', settings, environment));
  return withPlanAccount('workbuddy', settings, cookie, async () => {
    const deadline = Date.now() + 5_000;
    const post = (path, body = {}) => {
      if (Date.now() >= deadline) throw Object.assign(new Error('WorkBuddy 请求超时。'), { code: 'timeout' });
      return requestJson(`${ORIGIN}/billing/meter/${path}`, { method: 'POST', body,
        headers: { Cookie: cookie, 'User-Agent': userAgent, Origin: ORIGIN,
          Referer: `${ORIGIN}/profile/plans-usage`, 'Content-Type': 'application/json' },
        timeoutMs: Math.max(1, deadline - Date.now()), fetcher });
    };
    const result = parseWorkBuddyUsage(await post('get-user-resource-summary'), { now });
    if (!result.creditBalance) return result;
    const dates = await Promise.all([['paid', PAID], ['free', FREE]].map(async ([kind, codes]) => {
      try {
        return workBuddyReset(await post(`get-user-resource-${kind}-packages`, {
          PageNumber: 1, PageSize: 100, PackageCodes: codes.map(code => `TCACA_code_${code}`), Status: [0, 3],
        }), now);
      } catch { return null; } // Optional cycle evidence must not hide a valid balance.
    }));
    const resetsAt = dates.filter(Boolean).sort()[0] || null;
    result.creditBalance.resetsAt = resetsAt;
    for (const window of result.windows) window.resetsAt = resetsAt;
    return result;
  });
}
