import { loadCopilotCredentials, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const USAGE_URL = 'https://api.github.com/copilot_internal/user';

function number(value) {
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

export function parseCopilotUsage(payload, identity = {}, { now = new Date() } = {}) {
  const snapshots = payload?.quota_snapshots || {};
  const resetsAt = asDate(payload?.quota_reset_date);
  const windows = [
    quotaWindow(snapshots.premium_interactions, 'premium', 'Premium Requests', resetsAt),
    quotaWindow(snapshots.chat, 'chat', 'Chat', resetsAt),
  ].filter(Boolean);
  const unlimited = Object.values(snapshots).some((snapshot) => snapshot?.unlimited === true);
  return {
    id: 'copilot', label: 'GitHub Copilot', status: windows.length || unlimited ? 'ok' : 'empty',
    account: identity.account || null, plan: payload?.copilot_plan || null,
    source: identity.source || 'GitHub CLI 登录', updatedAt: now.toISOString(), windows,
    notice: unlimited ? '该账户包含 Unlimited 项目；不会用虚假的 100% 剩余条代替。' : 'Premium Requests 与 Chat 按 GitHub 月度订阅窗口展示。',
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
    source = settings.authMode === 'keychain' ? '本工具 macOS 钥匙串' : settings.environmentVariable;
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
  return parseCopilotUsage(payload, { source });
}
