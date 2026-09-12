import { createHash } from 'node:crypto';
import { requestJson } from '../http.js';
import { withPlanAccount, planError, planSecret, planSnapshot, quotaDate, quotaNumber, quotaWindow } from './coding-plan-common.js';

export const MINIMAX_NOTICE = '官方 Coding / Token Plan 额度；usage_count 在此接口表示剩余量。仅百分比窗口不伪造 Token 总额；未包含或无可量化上限的窗口不生成进度条。';

export function parseMiniMaxQuota(payload, { now = new Date() } = {}) {
  const data = payload?.data ?? payload;
  const status = data?.base_resp?.status_code ?? payload?.base_resp?.status_code;
  if (status != null && Number(status) !== 0) throw planError(Number(status) === 1004 ? 'unauthorized' : 'provider_error');
  if (!Array.isArray(data?.model_remains) || data.model_remains.length > 32) throw planError();
  const windows = data.model_remains.flatMap((model, index) => {
    if (!model || typeof model !== 'object') throw planError();
    const name = typeof model.model_name === 'string' ? model.model_name.trim() : '';
    if ((!name && data.model_remains.length > 1) || name.length > 80) throw planError();
    const id = name ? createHash('sha256').update(name).digest('hex').slice(0, 20) : `model-${index}`;
    return ['interval', 'weekly'].flatMap(kind => {
      if (kind === 'weekly' && name && !/^(general|minimax-m.*|m2\..*)$/i.test(name)) return [];
      const total = quotaNumber(model[`current_${kind}_total_count`]);
      const remaining = quotaNumber(model[`current_${kind}_usage_count`]);
      const remainingPercent = quotaNumber(model[`current_${kind}_remaining_percent`]);
      const status = quotaNumber(model[`current_${kind}_status`]);
      // Status 3 includes both unavailable and unlimited placeholders. Neither
      // is a quantitative zero-used window under our quota contract.
      if (status === 3) return [];
      const numeric = total > 0 && remaining != null;
      if (!numeric && remainingPercent == null) return [];
      const used = numeric && remainingPercent == null ? Math.max(0, total - remaining) : null;
      const start = quotaDate(model[kind === 'weekly' ? 'weekly_start_time' : 'start_time']);
      const end = quotaDate(model[kind === 'weekly' ? 'weekly_end_time' : 'end_time']);
      const duration = start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : null;
      const seconds = duration > 0 && duration <= 366 * 86400 ? duration : null;
      return [quotaWindow({ id: `${id}-${kind}`, label: `${name || 'Coding Plan'} · ${kind === 'weekly' ? '每周' : seconds === 18000 ? '5 小时' : '额度'}`,
        used, total: used == null ? null : total, percent: remainingPercent == null ? null : 100 - remainingPercent,
        unit: used == null ? null : 'quota units', seconds, reset: end, now })].filter(Boolean);
    });
  });
  if (data.model_remains.length && !windows.length && !data.model_remains.every(m => m.current_interval_status === 3 || m.current_weekly_status === 3)) throw planError();
  return planSnapshot('minimax', 'MiniMax', windows,
    data.current_subscribe_title || data.plan_name || data.combo_title || data.current_plan_title || data.current_combo_card?.title,
    now, MINIMAX_NOTICE);
}

export async function fetchMiniMaxLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const secret = planSecret('minimax', settings, environment);
  return withPlanAccount('minimax', settings, secret, async () => {
    const host = settings.site === 'china' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
    const request = path => requestJson(`${host}${path}`, { fetcher,
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'MM-API-Source': 'kbu-usage' } });
    let result;
    try { result = parseMiniMaxQuota(await request('/v1/token_plan/remains')); }
    catch (error) {
      // Compatibility fallback stays in the explicitly selected region. Network
      // and parse failures must not be disguised by switching account hosts.
      if (error.status !== 404 && error.code !== 'unauthorized') throw error;
      try { result = parseMiniMaxQuota(await request('/v1/api/openplatform/coding_plan/remains')); }
      catch (fallback) { throw error.code === 'unauthorized' ? error : fallback; }
    }
    return { ...result, source: new URL(host).hostname };
  });
}
