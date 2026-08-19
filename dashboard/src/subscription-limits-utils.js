/* 订阅/权益纯函数(20260816 自 SubscriptionLimits.jsx 拆出):
   组件文件只导出组件以恢复 Fast Refresh;测试经 vite ssrLoadModule 引用。 */
import { compactNumber, pluralUnit } from './format.js';

export const PROVIDER_TONES = {
  codex: 'blue', 'kimi-code': 'amber', warp: 'violet',
  antigravity: 'green', 'jetbrains-ai': 'pink', 'claude-code': 'amber', cursor: 'blue',
  copilot: 'violet', opencode: 'amber', qoder: 'green', trae: 'blue',
};

export function idSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function hasEnteredSecrets(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((entry) => hasEnteredSecrets(entry));
}

export function isValidOpenCodeWorkspaceId(value) {
  return /^wrk_[A-Za-z0-9_-]+$/.test(String(value || '').trim());
}

export function localizedCompact(value, zh) {
  return compactNumber(value, zh ? 'zh' : 'en');
}

export function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function limitWindowDetail(window) {
  const value = finiteNumber(window?.value);
  const limit = finiteNumber(window?.limit);
  if (value == null || limit == null) return window?.detail || null;
  return `${value.toLocaleString()} / ${limit.toLocaleString()} ${window?.unit || ''}`;
}

const QUOTA_WINDOW_LABELS = {
  codex: {
    primary: ['5 小时', '5 hours'], secondary: ['每周', 'Weekly'],
    'spend-control': ['月度 Credits', 'Monthly credits'],
  },
  'claude-code': {
    five_hour: ['5 小时', '5 hours'], seven_day: ['每周', 'Weekly'],
    seven_day_opus: ['Opus · 每周', 'Opus · Weekly'],
    seven_day_sonnet: ['Sonnet · 每周', 'Sonnet · Weekly'],
    seven_day_oauth_apps: ['OAuth Apps · 每周', 'OAuth Apps · Weekly'],
    seven_day_routines: ['Routines · 每周', 'Routines · Weekly'],
    seven_day_claude_routines: ['Routines · 每周', 'Routines · Weekly'],
    seven_day_cowork: ['Cowork · 每周', 'Cowork · Weekly'],
  },
  'kimi-code': {
    session: ['5 小时滚动（5H 频限）', '5-hour rolling (5H rate limit)'],
    weekly: ['每周', 'Weekly'], 'code-weekly': ['Code 每周', 'Code weekly'],
    total: ['订阅总额度', 'Subscription total'],
  },
  cursor: {
    plan: ['套餐 Credits', 'Plan credits'], overall: ['个人额度', 'Personal allowance'],
    pooled: ['团队共享额度', 'Team shared allowance'],
    'plan-auto': ['Auto Credits', 'Auto credits'], 'plan-api': ['API Credits', 'API credits'],
    'on-demand': ['按需用量', 'On-demand usage'],
  },
  copilot: {
    premium: ['Premium Requests', 'Premium Requests'], chat: ['Chat', 'Chat'],
  },
  opencode: {
    rolling: ['5 小时滚动', '5-hour rolling'], weekly: ['每周', 'Weekly'],
    monthly: ['每月', 'Monthly'],
  },
  warp: {
    credits: ['月度 Credits', 'Monthly credits'], bonus: ['附加 Credits', 'Bonus credits'],
  },
  'jetbrains-ai': { credits: ['当前 Credits', 'Current credits'] },
};

function normalizeChineseWindowLabel(value) {
  return String(value || '').replaceAll('Code 7 天', 'Code 每周').replaceAll('7 天', '每周');
}

function englishWindowLabel(value) {
  let result = normalizeChineseWindowLabel(value);
  const replacements = [
    ['5 小时滚动（5H 频限）', '5-hour rolling (5H rate limit)'],
    ['5 小时滚动', '5-hour rolling'],
    ['订阅总额度', 'Subscription total'],
    ['个人 + 共享 Credits', 'Personal + shared credits'],
    ['团队共享额度', 'Team shared allowance'],
    ['套餐 Credits', 'Plan credits'],
    ['月度 Credits', 'Monthly credits'],
    ['附加 Credits', 'Bonus credits'],
    ['当前 Credits', 'Current credits'],
    ['额外额度', 'Additional quota'],
    ['个人额度', 'Personal allowance'],
    ['按需用量', 'On-demand usage'],
    ['Gemini 模型', 'Gemini models'],
    ['Claude / GPT 模型', 'Claude / GPT models'],
    ['其他模型', 'Other models'],
    ['5 小时', '5 hours'],
    ['Code 每周', 'Code weekly'],
    ['每周', 'Weekly'],
    ['每月', 'Monthly'],
    ['每天', 'Daily'],
  ];
  for (const [source, target] of replacements) result = result.replaceAll(source, target);
  result = result.replace(/^额外额度 (\d+)$/, 'Additional quota $1');
  result = result.replace(/^额度 (\d+)$/, 'Quota $1');
  result = result.replaceAll('额度', 'Quota');
  return result;
}

export function quotaWindowLabel(providerId, window, zh) {
  const pair = QUOTA_WINDOW_LABELS[providerId]?.[window?.id];
  if (pair) return pair[zh ? 0 : 1];
  return zh ? normalizeChineseWindowLabel(window?.label) : englishWindowLabel(window?.label);
}

export function quotaWindowDetail(providerId, window, zh) {
  const detail = limitWindowDetail(window);
  if (!detail) return detail;
  if (zh) return normalizeChineseWindowLabel(detail);
  const pool = detail.match(/^Antigravity 返回的 (.+)额度池$/);
  if (pool) return `Antigravity ${englishWindowLabel(pool[1]).toLowerCase()} quota pool`;
  const tightest = detail.match(/^最紧张：(.*)$/);
  if (tightest) return `Tightest: ${tightest[1]}`;
  return detail;
}

const ENGLISH_PROVIDER_NOTICES = new Map([
  ['订阅额度来自本机 Codex 登录会话，不等同于标准 API 速率限制。', 'Subscription quotas come from the local Codex login and are not standard API rate limits.'],
  ['来自 Claude Code OAuth 订阅窗口；它不等同于 Anthropic API 组织限额。', 'These are Claude Code OAuth subscription windows, not Anthropic API organization limits.'],
  ['Kimi Code 本机登录可读取 5 小时滚动（5H 频限）与每周额度；订阅总额度需要 Kimi Web 登录令牌。', 'The local Kimi Code login exposes the 5-hour rolling rate limit and weekly quota. Subscription totals require a Kimi Web token.'],
  ['额度来自 Kimi 账户接口，按请求/订阅窗口展示。', 'Quotas come from the Kimi account API and are shown by request or subscription cycle.'],
  ['Cursor 金额字段按官网账期 Credits 展示；这不是标准 API 账单。', 'Cursor monetary fields follow its billing-cycle credits and are not a standard API bill.'],
  ['该账户包含 Unlimited 项目；不会用虚假的 100% 剩余条代替。', 'This account includes unlimited items; they are not replaced with a misleading 100%-remaining bar.'],
  ['GitHub 将该账户标记为按量计费，但没有返回可验证的剩余额度比例；不会推测额度。', 'GitHub marks this account as usage-based billing but provides no verifiable remaining percentage, so no balance is inferred.'],
  ['Premium Requests 与 Chat 按 GitHub 月度订阅窗口展示。', 'Premium Requests and Chat follow the GitHub monthly subscription cycle.'],
  ['GitHub 当前登录没有返回可验证的个人额度窗口；这不代表免费、无限或未使用。', 'The current GitHub login exposes no verifiable personal quota window; this does not mean free, unlimited, or unused.'],
  ['本机服务返回 Gemini 与 Claude/GPT 的 5 小时和每周额度池。', 'The local service exposes 5-hour and weekly quota pools for Gemini and Claude/GPT models.'],
  ['同一模型家族显示剩余比例最低的文本模型额度，避免高估可用量。', 'Each model family shows the text-model quota with the lowest remaining percentage to avoid overstating availability.'],
  ['额度来自 OpenCode Go Workspace 订阅；本机 OpenCode Token 用量与该额度分开统计。', 'Quotas come from the OpenCode Go Workspace subscription; local OpenCode Token usage is tracked separately.'],
  ['已合并个人额度与团队共享额度，避免低估可用 Credits。', 'Personal and team-shared allowances are combined to avoid understating available credits.'],
  ['Qoder 按账户 Big Model Credits 展示。', 'Qoder is shown using account-level Big Model Credits.'],
  ['Warp 以 Credits 计量；主额度与附加额度分开显示。', 'Warp is measured in credits, with primary and bonus allowances shown separately.'],
  ['纯本地读取 JetBrains AI Assistant 配置，不会连接 JetBrains 网络服务。', 'JetBrains AI Assistant settings are read locally without connecting to JetBrains network services.'],
]);

export function quotaProviderNotice(value, zh) {
  if (!value) return null;
  const normalized = normalizeChineseWindowLabel(value);
  if (zh) return normalized;
  return ENGLISH_PROVIDER_NOTICES.get(normalized)
    || (/\p{Script=Han}/u.test(normalized) ? 'Provider quota details are shown above.' : normalized);
}

const ENGLISH_SOURCES = new Map([
  ['Kimi Web 登录令牌', 'Kimi Web token'],
  ['Cursor 登录', 'Cursor login'],
  ['Cursor 桌面端登录', 'Cursor desktop login'],
  ['GitHub CLI 登录', 'GitHub CLI login'],
  ['Qoder Web 登录', 'Qoder Web login'],
  ['OpenCode Go Web 登录', 'OpenCode Go Web login'],
  ['本工具 macOS 钥匙串', 'usage-cli macOS Keychain'],
  ['agy 本机服务', 'Local agy service'],
  ['Antigravity IDE 本机服务', 'Local Antigravity IDE service'],
  ['Antigravity 本机服务', 'Local Antigravity service'],
]);

export function quotaSourceDisplay(value, zh) {
  if (!value) return '—';
  if (/[~\/\\]/.test(value)) return zh ? '本机凭据' : 'Local credential';
  if (zh) return value;
  if (ENGLISH_SOURCES.has(value)) return ENGLISH_SOURCES.get(value);
  if (value.startsWith('GitHub 设备授权 · ')) return value.replace('GitHub 设备授权 · ', 'GitHub device authorization · ');
  return /\p{Script=Han}/u.test(value) ? 'Local provider credential' : value;
}

export function quotaErrorMessage(provider, zh) {
  if (zh) return provider?.error?.message || '额度查询失败。';
  const label = provider?.label || 'Provider';
  const messages = {
    not_configured: `${label} is not configured or no local login was found.`,
    unauthorized: `${label} login expired or cannot read quota.`,
    timeout: `${label} quota request timed out.`,
    network_error: `${label} quota service is unreachable.`,
    invalid_response: `${label} returned an unsupported quota response.`,
    provider_error: `${label} quota service returned an error.`,
  };
  return messages[provider?.error?.code] || 'Quota request failed.';
}

export function quotaPageError(value, zh) {
  if (!value) return zh ? '权益数据读取失败。' : 'Could not load benefit data.';
  return zh || !/\p{Script=Han}/u.test(String(value))
    ? String(value)
    : 'Could not load benefit data. Try again.';
}

const ENGLISH_CATALOG_COPY = {
  codex: {
    description: 'ChatGPT Codex subscription windows and reset credits',
    localHint: 'Reuses the Codex CLI login automatically; no token copying required.',
  },
  'claude-code': {
    description: 'Claude 5-hour, weekly, and model quotas',
    localHint: 'Uses the Claude Code login first. If a newer Claude version stores it only in Keychain, choose an environment variable or the usage-cli Keychain entry.',
  },
  'kimi-code': {
    description: '5-hour rolling rate limit, weekly quota, and subscription total',
    localHint: 'Reuses the Kimi Code CLI login. A manual token is needed only for the Web subscription total.',
    secretKind: 'Kimi login token',
  },
  cursor: {
    description: 'Plan credits, on-demand usage, and billing cycle',
    localHint: 'Reads the Cursor desktop login automatically. If it is not detected, paste the Cookie from a cursor.com request.',
  },
  copilot: {
    description: 'Premium Requests, Chat, or usage-based billing status',
    localHint: 'GitHub device authorization is recommended. Add multiple GitHub accounts and switch between their quotas; GitHub CLI login remains a compatibility fallback.',
  },
  antigravity: {
    description: '5-hour and weekly quota pools for Gemini and Claude/GPT',
    localHint: 'Uses a running Antigravity or agy local service first. CodexBar OAuth or an OAuth credentials JSON can also be used.',
    secretKind: 'OAuth credentials JSON',
  },
  opencode: {
    description: '5-hour, weekly, and monthly Go subscription quotas',
    localHint: 'Each account stores its name, Cookie, and Workspace ID separately; all three are required before its quota is queried.',
  },
  qoder: {
    description: 'Personal and shared Big Model Credits',
    localHint: 'Sign in to the Qoder usage page and paste a request Cookie; international and China sites are selectable.',
  },
  warp: {
    description: 'Monthly credits (unavailable for some accounts)',
    localHint: 'Warp currently requires an API key, and some accounts expose no quota. Local Token analytics remain available either way.',
  },
  'jetbrains-ai': {
    description: 'Local quota cache (not available for every account)',
    localHint: 'Reads the most recently used IDE quota cache. Local Token analytics remain available when the IDE has not written quota fields.',
  },
  trae: {
    description: 'Subscription quota unavailable; support is still being evaluated',
    localHint: 'Trae does not expose a stable, verifiable personal subscription quota API. usage-cli never asks for a password or shows guessed data.',
  },
};

function englishDetection(provider) {
  const detection = provider?.detection || {};
  const raw = String(detection.label || '');
  const state = detection.state || 'not_detected';
  let label;
  const connectedAccounts = raw.match(/^(\d+) 个 GitHub 账户已连接$/);
  const configuredAccounts = raw.match(/^(\d+)(?:\/(\d+))? 个 OpenCode Go 账户已配置$/);
  const environment = raw.match(/^已配置环境变量 (.+)$/);
  if (connectedAccounts) label = `${connectedAccounts[1]} GitHub accounts connected`;
  else if (configuredAccounts) label = configuredAccounts[2]
    ? `${configuredAccounts[1]}/${configuredAccounts[2]} OpenCode Go accounts configured`
    : `${configuredAccounts[1]} OpenCode Go accounts configured`;
  else if (environment) label = `Environment variable ${environment[1]} configured`;
  else if (raw === '已安全保存到 macOS 钥匙串') label = 'Saved securely in macOS Keychain';
  else if (state === 'detected') label = provider.id === 'jetbrains-ai'
    ? 'JetBrains AI configuration detected'
    : provider.id === 'antigravity' && raw.includes('OAuth')
      ? 'Antigravity OAuth detected'
      : `${provider.label} access detected`;
  else if (state === 'configured') label = `${provider.label} configured`;
  else if (state === 'expired') label = `${provider.label} login expired`;
  else if (state === 'needs_login') label = `Sign in to ${provider.label}`;
  else if (state === 'manual') label = provider.id === 'opencode'
    ? 'Connect an OpenCode Go account'
    : 'Manual connection required';
  else if (state === 'unavailable') label = 'Subscription quota unavailable';
  else label = `${provider.label} not detected`;

  let detail = '';
  if (provider.id === 'codex' && state === 'needs_login') detail = 'Run codex and finish signing in';
  else if (provider.id === 'claude-code' && state === 'needs_login') detail = 'Run claude and finish signing in';
  else if (provider.id === 'claude-code' && state === 'expired') detail = 'Run claude to sign in again';
  else if (provider.id === 'cursor' && state === 'needs_login') detail = 'Open the Cursor desktop app and sign in';
  else if (provider.id === 'cursor' && state === 'expired') detail = 'Sign in again in the Cursor desktop app';
  else if (provider.id === 'copilot' && state === 'needs_login') detail = 'Run gh auth login';
  else if (provider.id === 'antigravity' && state === 'detected' && String(detection.detail || '').includes('127.0.0.1')) detail = 'The local 127.0.0.1 quota service is preferred when available';
  else if (provider.id === 'antigravity' && state === 'not_detected') detail = 'Start and sign in to Antigravity, or run agy';
  else if (provider.id === 'opencode' && state === 'manual') detail = 'Each account needs a name, Cookie, and Workspace ID';
  else if (detection.detail && !/\p{Script=Han}/u.test(detection.detail)) detail = detection.detail;
  return { ...detection, label, detail };
}

export function quotaProviderCatalogCopy(provider, zh) {
  if (zh) return provider;
  const copy = ENGLISH_CATALOG_COPY[provider.id] || {};
  return { ...provider, ...copy, detection: englishDetection(provider) };
}

export function resetCreditPresentation(resetCredits, zh = false) {
  const supplied = resetCredits?.availableCount;
  const count = typeof supplied === 'number' && Number.isFinite(supplied) ? supplied : null;
  if (count == null || count < 0) return {
    state: 'unknown', value: '—', detail: zh ? '可用数量不可观测' : 'Available count is not observable',
  };
  if (count === 0) return {
    state: 'zero', value: '0', detail: zh ? '已观测到可用数量为 0' : 'Observed available count: 0',
  };
  return {
    state: 'available', value: Math.floor(count).toLocaleString(), detail: null,
  };
}

export function localizedCount(value, zh, cnUnit, singular, plural) {
  return zh ? `${value} ${cnUnit}` : `${value} ${pluralUnit(value, singular, plural)}`;
}

export const ENTITLEMENT_TYPES = ['unknown', 'paid', 'free', 'promotion', 'organization'];

export function entitlementLabel(type, zh) {
  const labels = {
    unknown: zh ? '未分类' : 'Unclassified',
    paid: zh ? '付费订阅' : 'Paid subscription',
    free: zh ? '免费额度' : 'Free allowance',
    promotion: zh ? '试用 / 活动权益' : 'Trial / promotion',
    organization: zh ? '单位 / 团队提供' : 'Organization-provided',
  };
  return labels[type] || labels.unknown;
}

/* 卡片徽标短词(20260816):权益标注并入各平台展开面板后,
   列表卡只用一枚小徽标提示当前口径,详情在展开面板里改 */
export function entitlementBadge(type, zh) {
  const badges = {
    paid: zh ? '付费' : 'Paid',
    free: zh ? '免费' : 'Free',
    promotion: zh ? '试用' : 'Trial',
    organization: zh ? '单位' : 'Org',
    unknown: zh ? '未标注' : 'Untagged',
  };
  return badges[type] || badges.unknown;
}

export function entitlementNote(type, zh) {
  if (type === 'paid') return zh ? '计入个人支出、续费与付费闲置分析。' : 'Included in personal spend, renewal, and paid-idle analysis.';
  if (type === 'free') return zh ? '保留 Token 价值分析，不计入个人支出。' : 'Usage value remains visible without entering personal spend.';
  if (type === 'promotion') return zh ? '适合记录试用、赠送和限时活动额度。' : 'For trials, grants, and time-limited promotional allowances.';
  if (type === 'organization') return zh ? '由单位或团队承担，不计入个人支出。' : 'Paid by an organization or team, not personal spend.';
  return zh ? '未分类不会被当成免费、付费或无限。' : 'Unclassified is never assumed free, paid, or unlimited.';
}
