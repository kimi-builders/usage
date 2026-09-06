import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeJwtPayload } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';
import { queryDbJson } from '../../parsers/sqlite.js';

const USAGE_URL = 'https://codewhisperer.us-east-1.amazonaws.com/';

function text(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function storedJson(value) {
  let current = text(value);
  for (let attempt = 0; attempt < 2 && current; attempt += 1) {
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed === 'string') { current = parsed; continue; }
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function kiroDatabasePath(environment = process.env, platform = process.platform) {
  const override = text(environment.KIRO_DATA_DIR);
  if (override) return join(resolve(override.replace(/^~(?=$|\/)/, homedir())), 'data.sqlite3');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3');
  if (platform === 'win32') {
    const root = text(environment.LOCALAPPDATA) || join(homedir(), 'AppData', 'Local');
    return join(root, 'kiro-cli', 'data.sqlite3');
  }
  const root = text(environment.XDG_DATA_HOME) || join(homedir(), '.local', 'share');
  return join(root, 'kiro-cli', 'data.sqlite3');
}

export function loadKiroCredentials(environment = process.env, {
  query = queryDbJson, exists = existsSync, platform = process.platform,
} = {}) {
  const path = kiroDatabasePath(environment, platform);
  if (!exists(path)) return { found: false, fresh: false, path };
  try {
    const tokenRecord = storedJson(query(
      path,
      "SELECT value FROM auth_kv WHERE key='kirocli:odic:token' LIMIT 1",
    )[0]?.value);
    const profileRecord = storedJson(query(
      path,
      "SELECT value FROM state WHERE key='api.codewhisperer.profile' LIMIT 1",
    )[0]?.value);
    const accessToken = text(tokenRecord?.access_token || tokenRecord?.accessToken);
    const profileArn = text(profileRecord?.arn || profileRecord?.profileArn || profileRecord?.profile_arn);
    const claims = decodeJwtPayload(accessToken);
    const expiresAt = Number(claims.exp);
    const fresh = Boolean(accessToken && profileArn
      && (!Number.isFinite(expiresAt) || expiresAt > Date.now() / 1_000 + 60));
    return {
      found: Boolean(accessToken && profileArn), fresh, path, accessToken, profileArn,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    };
  } catch {
    return { found: false, fresh: false, path };
  }
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function resetDate(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && (numeric < 1_000_000_000 || numeric > 4_102_444_800)) return null;
  return asDate(value);
}

function creditWindow(id, label, used, limit, resetsAt) {
  if (used == null || limit == null || limit <= 0 || used > limit) return null;
  const usedPercent = asPercent(used / limit * 100);
  return {
    id, label, usedPercent, remainingPercent: 100 - usedPercent,
    resetsAt, value: used, limit, unit: 'credits',
  };
}

export function parseKiroUsage(payload, identity = {}, { now = new Date() } = {}) {
  const entries = Array.isArray(payload?.usageBreakdownList) ? payload.usageBreakdownList : [];
  const credits = entries.filter((entry) => String(entry?.resourceType || '').toUpperCase() === 'CREDIT');
  const credit = credits[0];
  if (credits.length !== 1) {
    const error = new Error(credits.length ? 'Kiro 返回了多个 CREDIT 额度，无法安全选择。' : 'Kiro 返回数据中没有 CREDIT 额度。');
    error.code = 'invalid_response';
    throw error;
  }
  const totalUsed = finite(credit.currentUsageWithPrecision ?? credit.currentUsage);
  const planLimit = finite(credit.usageLimitWithPrecision ?? credit.usageLimit);
  const rawOverageUsed = credit.currentOveragesWithPrecision ?? credit.currentOverages;
  const overageUsed = rawOverageUsed == null || rawOverageUsed === '' ? 0 : finite(rawOverageUsed);
  const overageEnabled = String(payload?.overageConfiguration?.overageStatus || '').toUpperCase() === 'ENABLED';
  const rawOverageCap = credit.overageCapWithPrecision ?? credit.overageCap;
  const overageCap = !overageEnabled || rawOverageCap == null || rawOverageCap === ''
    ? null
    : finite(rawOverageCap);
  if (totalUsed == null || planLimit == null || overageUsed == null
      || (overageEnabled && rawOverageCap != null && rawOverageCap !== '' && overageCap == null)
      || totalUsed < overageUsed
      || (overageEnabled && overageCap != null && overageUsed > overageCap)) {
    const error = new Error('Kiro CREDIT 额度包含无效数值。');
    error.code = 'invalid_response';
    throw error;
  }
  const resetsAt = resetDate(credit.nextDateReset ?? payload.nextDateReset);
  if (!resetsAt) {
    const error = new Error('Kiro CREDIT 额度缺少可信的重置时间。');
    error.code = 'invalid_response';
    throw error;
  }
  const hasBonuses = Array.isArray(credit.bonuses) && credit.bonuses.length > 0;
  const planUsed = totalUsed - overageUsed;
  const plan = hasBonuses ? null : creditWindow('monthly', '月度 Credits', planUsed, planLimit, resetsAt);
  if (!hasBonuses && !plan) {
    const error = new Error('Kiro CREDIT 用量超过套餐额度，且无法验证拆分结果。');
    error.code = 'invalid_response';
    throw error;
  }
  const overage = overageEnabled ? creditWindow('overage', '超额 Credits', overageUsed, overageCap, resetsAt) : null;
  const windows = [plan, overage].filter(Boolean);
  return {
    id: 'kiro', label: 'Kiro', status: windows.length ? 'ok' : 'empty',
    account: identity.account || null, plan: null,
    source: identity.source || 'Kiro CLI 登录', updatedAt: now.toISOString(), windows,
    notice: hasBonuses
      ? 'Kiro 返回了奖励 Credits，无法可靠拆分套餐与奖励用量；仅展示可独立验证的超额额度。'
      : '额度来自 Kiro CLI 本地登录对应的官方 CodeWhisperer 账户接口；单位为 Credits。',
  };
}

export async function fetchKiroLimits({
  environment = process.env, fetcher = fetch, credentialLoader = loadKiroCredentials,
} = {}) {
  const credentials = credentialLoader(environment);
  if (!credentials.found || !credentials.fresh) {
    const error = new Error(credentials.found
      ? 'Kiro CLI 登录已过期，请运行 kiro-cli login 重新登录。'
      : '未检测到 Kiro CLI 登录，请先运行 kiro-cli login。');
    error.code = credentials.found ? 'unauthorized' : 'not_configured';
    throw error;
  }
  const payload = await requestJson(USAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'AmazonCodeWhispererService.GetUsageLimits',
      'User-Agent': 'kbu-usage',
    },
    body: { profileArn: credentials.profileArn },
    fetcher,
  });
  return parseKiroUsage(payload);
}
