import { loadCopilotCredentials, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const USAGE_URL = 'https://api.github.com/copilot_internal/user';
const IDENTITY_URL = 'https://api.github.com/user';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';
// Copilot's internal usage surface accepts the same public-client device flow
// used by VS Code/CodexBar. A custom client can be supplied for self-hosted
// builds without changing persisted credentials.
const DEFAULT_DEVICE_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

function formBody(values) {
  return new URLSearchParams(values).toString();
}

export async function requestCopilotDeviceCode({
  fetcher = fetch, clientId = process.env.KBU_GITHUB_OAUTH_CLIENT_ID || DEFAULT_DEVICE_CLIENT_ID,
} = {}) {
  const payload = await requestJson(DEVICE_CODE_URL, {
    method: 'POST', fetcher,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formBody({ client_id: clientId, scope: 'read:user' }),
  });
  const expiresIn = Number(payload.expires_in);
  const interval = Number(payload.interval);
  if (!payload.device_code || !payload.user_code || !payload.verification_uri
    || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    const error = new Error('GitHub 没有返回完整的设备授权信息。');
    error.code = 'invalid_response'; throw error;
  }
  return {
    deviceCode: String(payload.device_code),
    userCode: String(payload.user_code),
    verificationUri: String(payload.verification_uri_complete || payload.verification_uri),
    expiresIn,
    interval: Number.isFinite(interval) && interval >= 1 ? interval : 5,
    clientId,
  };
}

export async function pollCopilotDeviceToken({ deviceCode, clientId, fetcher = fetch } = {}) {
  const payload = await requestJson(DEVICE_TOKEN_URL, {
    method: 'POST', fetcher,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: formBody({
      client_id: clientId || process.env.KBU_GITHUB_OAUTH_CLIENT_ID || DEFAULT_DEVICE_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  if (payload.access_token) return { status: 'connected', token: String(payload.access_token) };
  if (payload.error === 'authorization_pending') return { status: 'pending' };
  if (payload.error === 'slow_down') return { status: 'pending', slowDown: true };
  const error = new Error(payload.error === 'expired_token'
    ? 'GitHub 设备验证码已过期，请重新连接。'
    : payload.error === 'access_denied'
      ? 'GitHub 设备授权已取消。'
      : 'GitHub 设备授权失败，请重试。');
  error.code = payload.error === 'expired_token' ? 'authorization_expired' : 'unauthorized';
  throw error;
}

export async function fetchCopilotIdentity(token, { fetcher = fetch } = {}) {
  const payload = await requestJson(IDENTITY_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kimi-builders-usage',
    },
    fetcher,
  });
  return {
    login: typeof payload.login === 'string' ? payload.login : null,
    id: Number.isSafeInteger(payload.id) ? String(payload.id) : null,
  };
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quotaWindow(snapshot, id, label, resetsAt) {
  if (!snapshot || snapshot.unlimited === true) return null;
  const entitlement = number(snapshot.entitlement);
  const remaining = number(snapshot.remaining);
  const percentRemaining = asPercent(snapshot.percent_remaining,
    entitlement != null && entitlement > 0 && remaining != null ? remaining / entitlement * 100 : null);
  if (percentRemaining == null || (entitlement === 0 && remaining === 0)) return null;
  return {
    id, label, usedPercent: 100 - percentRemaining, remainingPercent: percentRemaining,
    resetsAt, value: entitlement != null && remaining != null ? Math.max(0, entitlement - remaining) : null,
    limit: entitlement, unit: 'requests',
  };
}

function quotaCountWindow(monthly, remaining, id, label, resetsAt) {
  const entitlement = number(monthly);
  const available = number(remaining);
  if (entitlement == null || entitlement <= 0 || available == null) return null;
  return quotaWindow({ entitlement, remaining: Math.max(0, available) }, id, label, resetsAt);
}

function usableSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.unlimited === true) return false;
  return quotaWindow(snapshot, 'probe', 'probe', null) != null;
}

function snapshotPair(payload) {
  const snapshots = payload?.quota_snapshots && typeof payload.quota_snapshots === 'object'
    ? payload.quota_snapshots : {};
  let premium = snapshots.premium_interactions || null;
  let chat = snapshots.chat || null;
  if (!usableSnapshot(premium)) premium = null;
  if (!usableSnapshot(chat)) chat = null;
  let firstUsable = null;
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!usableSnapshot(snapshot)) continue;
    firstUsable ||= snapshot;
    const name = key.toLowerCase();
    if (!chat && name.includes('chat')) chat = snapshot;
    if (!premium && /premium|completion|code/.test(name)) premium = snapshot;
  }
  if (!premium && !chat) chat = firstUsable;
  return { premium, chat, snapshots };
}

export function parseCopilotUsage(payload, identity = {}, { now = new Date() } = {}) {
  const { premium, chat, snapshots } = snapshotPair(payload);
  const resetsAt = asDate(payload?.quota_reset_date);
  const monthly = payload?.monthly_quotas || {};
  const limited = payload?.limited_user_quotas || {};
  const windows = [
    quotaWindow(premium, 'premium', 'Premium Requests', resetsAt)
      || quotaCountWindow(monthly.completions, limited.completions, 'premium', 'Premium Requests', resetsAt),
    quotaWindow(chat, 'chat', 'Chat', resetsAt)
      || quotaCountWindow(monthly.chat, limited.chat, 'chat', 'Chat', resetsAt),
  ].filter(Boolean);
  const unlimited = Object.values(snapshots).some((snapshot) => snapshot?.unlimited === true);
  const tokenBasedBilling = payload?.token_based_billing === true;
  const observableWithoutWindow = unlimited || tokenBasedBilling;
  const notice = unlimited
    ? '该账户包含 Unlimited 项目；不会用虚假的 100% 剩余条代替。'
    : tokenBasedBilling
      ? 'GitHub 将该账户标记为按量计费，但没有返回可验证的剩余额度比例；不会推测额度。'
      : windows.length
        ? 'Premium Requests 与 Chat 按 GitHub 月度订阅窗口展示。'
        : 'GitHub 当前登录没有返回可验证的个人额度窗口；这不代表免费、无限或未使用。';
  return {
    id: 'copilot', label: 'GitHub Copilot', status: windows.length || observableWithoutWindow ? 'ok' : 'empty',
    account: identity.account || null, plan: payload?.copilot_plan || null,
    source: identity.source || 'GitHub CLI 登录', updatedAt: now.toISOString(), windows,
    notice,
  };
}

export async function fetchCopilotLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  let token;
  let source;
  if (settings.authMode === 'local') {
    const credentials = loadCopilotCredentials(environment);
    token = credentials.token; source = credentials.source;
  } else {
    token = resolveProviderSecret('copilot', settings, environment);
    source = settings.authMode === 'keychain'
      ? (settings.accountLabel ? `GitHub 设备授权 · ${settings.accountLabel}` : '本工具 macOS 钥匙串')
      : settings.environmentVariable;
  }
  if (!token) {
    const error = new Error('未找到 GitHub 登录。推荐先运行 gh auth login，再回来启用 Copilot。');
    error.code = 'not_configured'; throw error;
  }
  const payload = await requestJson(USAGE_URL, {
    headers: {
      Authorization: `token ${token}`,
      'Editor-Version': 'vscode/1.96.2',
      'Editor-Plugin-Version': 'copilot-chat/0.26.7',
      'User-Agent': 'GitHubCopilotChat/0.26.7',
      'X-Github-Api-Version': '2025-04-01',
    }, fetcher,
  });
  return parseCopilotUsage(payload, { source, account: settings.accountLabel || null });
}
