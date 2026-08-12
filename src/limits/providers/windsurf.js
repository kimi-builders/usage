import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { queryDbJson } from '../../parsers/sqlite.js';
import { asDate, asPercent } from '../http.js';

const CACHE_KEY = 'windsurf.settings.cachedPlanInfo';

function defaultDatabasePath(environment = process.env, platform = process.platform) {
  if (environment.WINDSURF_STATE_DB?.trim()) {
    return resolve(environment.WINDSURF_STATE_DB.trim().replace(/^~(?=$|\/)/, homedir()));
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
  }
  const root = environment.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config');
  return join(root, 'Windsurf', 'User', 'globalStorage', 'state.vscdb');
}

export function detectWindsurfDatabase(customPath = '', options = {}) {
  const path = customPath.trim()
    ? resolve(customPath.trim().replace(/^~(?=$|\/)/, homedir()))
    : defaultDatabasePath(options.environment, options.platform);
  return existsSync(path) ? path : null;
}

function jsonText(value) {
  if (typeof value === 'string') return value.trim();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    for (const encoding of ['utf8', 'utf16le']) {
      const decoded = bytes.toString(encoding).replace(/^\uFEFF/, '').replace(/\0+$/g, '').trim();
      try { JSON.parse(decoded); return decoded; } catch { /* try the next encoding */ }
    }
  }
  return '';
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function usageWindow({ id, label, used, remaining, total }) {
  const limit = numeric(total);
  let usedValue = numeric(used);
  const remainingValue = numeric(remaining);
  if (usedValue == null && limit != null && remainingValue != null) usedValue = Math.max(0, limit - remainingValue);
  if (limit == null || limit <= 0 || usedValue == null) return null;
  const safeUsed = Math.max(0, Math.min(limit, usedValue));
  const usedPercent = asPercent(safeUsed / limit * 100, 0);
  return {
    id, label, usedPercent, remainingPercent: 100 - usedPercent,
    resetsAt: null, value: safeUsed, limit,
  };
}

export function parseWindsurfPlan(value, { now = new Date(), source = 'Windsurf 本地缓存' } = {}) {
  let payload = value;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  if (!payload || typeof payload !== 'object') {
    const error = new Error('Windsurf 本地额度缓存无法解析。');
    error.code = 'invalid_response';
    throw error;
  }
  const quota = payload.quotaUsage || payload.quota_usage;
  const usage = payload.usage || {};
  const windows = [];
  const dailyRemaining = numeric(quota?.dailyRemainingPercent ?? quota?.daily_remaining_percent);
  if (dailyRemaining != null) {
    windows.push({
      id: 'daily', label: '每日额度', usedPercent: 100 - asPercent(dailyRemaining),
      remainingPercent: asPercent(dailyRemaining),
      resetsAt: asDate(quota?.dailyResetAtUnix ?? quota?.daily_reset_at_unix), windowSeconds: 86_400,
    });
  }
  const weeklyRemaining = numeric(quota?.weeklyRemainingPercent ?? quota?.weekly_remaining_percent);
  if (weeklyRemaining != null) {
    windows.push({
      id: 'weekly', label: '每周额度', usedPercent: 100 - asPercent(weeklyRemaining),
      remainingPercent: asPercent(weeklyRemaining),
      resetsAt: asDate(quota?.weeklyResetAtUnix ?? quota?.weekly_reset_at_unix), windowSeconds: 604_800,
    });
  }
  if (!windows.length) {
    windows.push(usageWindow({
      id: 'messages', label: '消息额度', used: usage.usedMessages ?? usage.used_messages,
      remaining: usage.remainingMessages ?? usage.remaining_messages, total: usage.messages,
    }));
    windows.push(usageWindow({
      id: 'flow-actions', label: 'Flow Actions', used: usage.usedFlowActions ?? usage.used_flow_actions,
      remaining: usage.remainingFlowActions ?? usage.remaining_flow_actions,
      total: usage.flowActions ?? usage.flow_actions,
    }));
  }
  const available = windows.filter(Boolean);
  if (!available.length) {
    const error = new Error('Windsurf 本地缓存中没有可识别的订阅额度。请打开 Windsurf 并确认已登录。');
    error.code = 'invalid_response';
    throw error;
  }
  return {
    id: 'windsurf', label: 'Windsurf', status: 'ok', account: null,
    plan: payload.planName || payload.plan_name || null,
    source, updatedAt: now.toISOString(), windows: available,
    notice: '纯本地读取 Windsurf 缓存；额度会在 Windsurf 运行时更新，可能略有延迟。',
  };
}

export async function fetchWindsurfLimits({ settings, environment = process.env } = {}) {
  const path = detectWindsurfDatabase(settings?.customPath || '', { environment });
  if (!path) {
    const error = new Error('未找到 Windsurf 本地额度缓存；请先安装、打开并登录 Windsurf。');
    error.code = 'not_configured';
    throw error;
  }
  let row;
  try {
    const escaped = CACHE_KEY.replaceAll("'", "''");
    row = queryDbJson(path, `SELECT value FROM ItemTable WHERE key='${escaped}' LIMIT 1`)[0];
  } catch {
    const error = new Error('无法读取 Windsurf 本地缓存；请稍后重试。');
    error.code = 'provider_error';
    throw error;
  }
  const raw = jsonText(row?.value);
  if (!raw) {
    const error = new Error('Windsurf 尚未写入额度缓存；请打开 Windsurf 并确认已登录。');
    error.code = 'not_configured';
    throw error;
  }
  return parseWindsurfPlan(raw, { source: 'Windsurf 本地缓存' });
}
