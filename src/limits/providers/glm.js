import { requestJson } from '../http.js';
import { withPlanAccount, planError, planSecret, planSnapshot, quotaNumber, quotaWindow } from './coding-plan-common.js';

export const GLM_NOTICE = '个人 Coding Plan 官方额度；TOKENS_LIMIT 名称不代表可用原始 Token。MCP 单独展示，不与本机 Token 或其他额度相加。';

export function parseGlmQuota(payload, { now = new Date() } = {}) {
  if (payload?.success !== true || payload?.code !== 200) throw planError([401, 403].includes(payload?.code) ? 'unauthorized' : 'invalid_response');
  if (!Array.isArray(payload.data?.limits) || payload.data.limits.length > 64) throw planError();
  const windows = payload.data.limits.flatMap(raw => {
    if (!raw || typeof raw !== 'object') throw planError();
    if (!['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(raw.type)) return [];
    if (!Number.isSafeInteger(raw.unit) || !Number.isSafeInteger(raw.number) || !Number.isInteger(raw.percentage)) throw planError();
    const mcp = raw.type === 'TIME_LIMIT';
    const duration = ({ 1: 86400, 3: 3600, 5: 60, 6: 604800 })[raw.unit] * raw.number;
    const seconds = Number.isSafeInteger(duration) && duration > 0 && duration <= 366 * 86400 ? duration : null;
    if (seconds == null && !mcp) throw planError();
    const total = quotaNumber(raw.usage);
    const current = quotaNumber(raw.currentValue);
    const remaining = quotaNumber(raw.remaining);
    const measured = total > 0 && (current != null || remaining != null);
    const used = measured ? Math.max(0, current ?? 0, remaining == null ? 0 : total - remaining) : null;
    // Provider quota units are not raw model tokens, even for TOKENS_LIMIT.
    return [quotaWindow({
      id: `${mcp ? 'mcp' : raw.type === 'CREDIT_LIMIT' ? 'credits' : 'plan'}-${raw.unit}-${raw.number}`,
      label: mcp ? 'MCP' : seconds === 18000 ? '5 小时' : seconds === 604800 ? '每周' : 'Coding Plan',
      used, total: measured ? total : null, percent: measured ? used / total * 100 : raw.percentage,
      unit: mcp ? 'requests' : 'quota units',
      // TIME_LIMIT unit=5/number=1 is a legacy MCP marker, not a minute cycle.
      seconds: mcp && raw.unit === 5 && raw.number === 1 ? null : seconds,
      reset: raw.nextResetTime, now,
    })];
  });
  const data = payload.data;
  return planSnapshot('glm', 'GLM / Z.ai', windows,
    data.planName || data.plan || data.plan_type || data.packageName || data.level, now, GLM_NOTICE);
}

export async function fetchGlmLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const secret = planSecret('glm', settings, environment);
  return withPlanAccount('glm', settings, secret, async () => {
    const host = settings.site === 'china' ? 'https://open.bigmodel.cn' : 'https://api.z.ai';
    const payload = await requestJson(`${host}/api/monitor/usage/quota/limit`, {
      fetcher, headers: { Authorization: `Bearer ${secret}` },
    });
    return { ...parseGlmQuota(payload), source: new URL(host).hostname };
  });
}
