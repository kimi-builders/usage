import { loadClaudeCredentials, resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';
import { claudeCloudCredits, claudeResetCredits, fetchClaudeSubscriptionDates } from './claude-benefits.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const WINDOW_LABELS = {
  five_hour: '5 小时', seven_day: '每周', seven_day_opus: 'Opus · 每周',
  seven_day_sonnet: 'Sonnet · 每周', seven_day_oauth_apps: 'OAuth Apps · 每周',
  seven_day_routines: 'Routines · 每周', seven_day_claude_routines: 'Routines · 每周',
  seven_day_cowork: 'Cowork · 每周',
};

function usageWindow(value, id, label) {
  if (!value || typeof value !== 'object') return null;
  const usedPercent = asPercent(value.utilization ?? value.percent ?? value.used_percent);
  if (usedPercent == null) return null;
  return {
    id, label, usedPercent, remainingPercent: 100 - usedPercent,
    resetsAt: asDate(value.resets_at ?? value.resetsAt),
  };
}

export function parseClaudeUsage(payload, identity = {}, { now = new Date() } = {}) {
  const windows = Object.entries(WINDOW_LABELS)
    .map(([key, label]) => usageWindow(payload?.[key], key, label)).filter(Boolean);
  for (const [index, item] of (Array.isArray(payload?.limits) ? payload.limits : []).entries()) {
    if (item?.is_active === false || item?.isActive === false) continue;
    const model = item?.scope?.model?.display_name || item?.scope?.model?.displayName;
    const window = usageWindow(item, `limit-${index}`, model ? `${model} · 每周` : (item?.kind || `额度 ${index + 1}`));
    if (window && !windows.some((entry) => entry.label === window.label && entry.resetsAt === window.resetsAt)) windows.push(window);
  }
  return {
    id: 'claude-code', label: 'Claude Code', status: windows.length ? 'ok' : 'empty',
    account: identity.email || null, plan: identity.plan || null,
    source: identity.source || '~/.claude/.credentials.json', updatedAt: now.toISOString(), windows,
    resetCredits: claudeResetCredits(payload?.cedar_ember, now),
    cloudCredits: claudeCloudCredits(payload?.iguana_necktie),
    notice: '来自 Claude Code OAuth 订阅窗口；它不等同于 Anthropic API 组织限额。',
  };
}

export async function fetchClaudeLimits({ settings, environment = process.env, fetcher = fetch, now = new Date() } = {}) {
  let accessToken;
  let sessionCookie = null;
  let identity = {};
  if (settings.authMode === 'local') {
    const credentials = loadClaudeCredentials(environment);
    if (!credentials.found || !credentials.fresh) {
      const error = new Error(credentials.found
        ? 'Claude Code 登录已过期，请运行 claude 重新登录，或切换为手动凭据。'
        : '未找到 Claude Code OAuth 登录；请先运行 claude 登录。');
      error.code = credentials.found ? 'unauthorized' : 'not_configured';
      throw error;
    }
    accessToken = credentials.accessToken;
    identity = { plan: credentials.plan, source: '~/.claude/.credentials.json' };
  } else {
    accessToken = resolveProviderSecret('claude-code', settings, environment);
    identity.source = settings.authMode === 'keychain' ? '本工具 macOS 钥匙串' : settings.environmentVariable;
    if (accessToken?.trim().startsWith('{')) {
      try {
        const tuple = JSON.parse(accessToken);
        accessToken = typeof tuple.accessToken === 'string' ? tuple.accessToken : null;
        sessionCookie = typeof tuple.sessionCookie === 'string' ? tuple.sessionCookie : null;
      } catch { accessToken = null; }
    }
  }
  if (!accessToken) {
    const error = new Error('未找到 Claude OAuth Access Token。请检查所选凭据来源。');
    error.code = 'not_configured'; throw error;
  }
  const options = {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'kbu-usage',
    }, fetcher,
  };
  let payload;
  try { payload = await requestJson(`${USAGE_URL}?cedar_ember=1`, options); }
  catch (error) {
    // Older usage endpoints may not accept the optional inventory flag.
    // Never retry authentication/rate-limit failures with a different identity.
    if (![400, 404].includes(error.status)) throw error;
    payload = await requestJson(USAGE_URL, options);
  }
  const result = parseClaudeUsage(payload, identity, { now });
  result.subscriptionDates = sessionCookie
    ? await fetchClaudeSubscriptionDates(accessToken, sessionCookie, { fetcher }) : null;
  return result;
}
