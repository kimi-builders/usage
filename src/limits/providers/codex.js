import { loadCodexCredentials } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

function titleForWindow(window, fallback) {
  const seconds = Number(window?.limit_window_seconds);
  if (seconds === 5 * 60 * 60) return '5 小时';
  if (seconds === 7 * 24 * 60 * 60) return '每周';
  if (seconds === 24 * 60 * 60) return '每天';
  return fallback;
}

function windowModel(window, id, label, { preferLabel = false } = {}) {
  if (!window || typeof window !== 'object') return null;
  const usedPercent = asPercent(window.used_percent);
  if (usedPercent == null) return null;
  return {
    id,
    label: preferLabel ? label : titleForWindow(window, label),
    usedPercent,
    remainingPercent: 100 - usedPercent,
    resetsAt: asDate(window.reset_at),
    windowSeconds: Number(window.limit_window_seconds) || null,
  };
}

function additionalWindows(payload) {
  return Array.isArray(payload?.additional_rate_limits)
    ? payload.additional_rate_limits.flatMap((item, index) => {
      const name = item?.limit_name || item?.metered_feature || `额外额度 ${index + 1}`;
      const rate = item?.rate_limit || {};
      return [
        windowModel(rate.primary_window, `additional-${index}-primary`, name, { preferLabel: true }),
        windowModel(rate.secondary_window, `additional-${index}-secondary`, `${name} · 每周`, { preferLabel: true }),
      ].filter(Boolean);
    })
    : [];
}

function spendWindow(payload) {
  const snapshot = payload?.individual_limit
    || payload?.rate_limit?.individual_limit
    || payload?.spend_control?.individual_limit;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const limit = Number(snapshot.limit);
  const used = Number(snapshot.used);
  const remainingPercent = asPercent(snapshot.remaining_percent ?? snapshot.remainingPercent,
    Number.isFinite(limit) && limit > 0 && Number.isFinite(used) ? 100 - (used / limit * 100) : null);
  if (remainingPercent == null) return null;
  return {
    id: 'spend-control',
    label: '月度 Credits',
    usedPercent: 100 - remainingPercent,
    remainingPercent,
    resetsAt: asDate(snapshot.reset_at ?? snapshot.resets_at ?? snapshot.resetsAt),
    value: Number.isFinite(used) ? used : null,
    limit: Number.isFinite(limit) ? limit : null,
    unit: 'credits',
  };
}

export function parseCodexUsage(payload, credentials, { resetCredits = null, now = new Date() } = {}) {
  const windows = [
    windowModel(payload?.rate_limit?.primary_window, 'primary', '5 小时'),
    windowModel(payload?.rate_limit?.secondary_window, 'secondary', '每周'),
    spendWindow(payload),
    ...additionalWindows(payload),
  ].filter(Boolean);
  const suppliedAvailableCredits = resetCredits?.available_count;
  const parsedAvailableCredits = typeof suppliedAvailableCredits === 'number' && Number.isFinite(suppliedAvailableCredits) && suppliedAvailableCredits >= 0
    ? Math.floor(suppliedAvailableCredits)
    : null;
  const available = Array.isArray(resetCredits?.credits)
    ? resetCredits.credits.filter((credit) => credit?.status === 'available'
      && (!credit.expires_at || new Date(credit.expires_at) > now))
    : [];
  const creditBalance = Number(payload?.credits?.balance);
  return {
    id: 'codex',
    label: 'Codex',
    status: windows.length ? 'ok' : 'empty',
    account: credentials.email || null,
    plan: payload?.plan_type || credentials.plan || null,
    source: '~/.codex/auth.json',
    updatedAt: now.toISOString(),
    windows,
    balance: Number.isFinite(creditBalance) ? { value: creditBalance, unit: 'credits' } : null,
    resetCredits: resetCredits == null ? null : {
      availableCount: parsedAvailableCredits == null
        ? (Array.isArray(resetCredits?.credits) ? available.length : null)
        : Math.max(parsedAvailableCredits, available.length),
      nextExpiry: available.map((credit) => asDate(credit.expires_at)).filter(Boolean).sort()[0] || null,
    },
    notice: '订阅额度来自本机 Codex 登录会话，不等同于标准 API 速率限制。',
  };
}

export async function fetchCodexLimits({ environment = process.env, fetcher = fetch } = {}) {
  const credentials = loadCodexCredentials(environment);
  if (!credentials.found) {
    const error = new Error('未找到 Codex 登录。请先运行 codex 并完成登录。');
    error.code = 'not_configured';
    throw error;
  }
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`,
    'User-Agent': 'kbu-usage',
    'OpenAI-Beta': 'codex-1',
    originator: 'kbu-usage',
  };
  if (credentials.accountId) headers['ChatGPT-Account-Id'] = credentials.accountId;
  const [usage, credits] = await Promise.all([
    requestJson(USAGE_URL, { headers, fetcher }),
    requestJson(RESET_CREDITS_URL, { headers, fetcher, timeoutMs: 4_000 }).catch(() => null),
  ]);
  return parseCodexUsage(usage, credentials, { resetCredits: credits });
}
