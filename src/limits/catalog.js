import { safeLocalPathDisplay } from '../safe-display.js';

export const LIMIT_PROVIDER_CATALOG = [
  {
    id: 'codex', label: 'Codex', group: 'recommended', popular: true,
    description: 'ChatGPT Codex 订阅窗口与重置额度', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local'], dashboardUrl: 'https://chatgpt.com/codex/settings/usage',
    localHint: '自动复用 Codex CLI 登录，无需复制 Token。',
  },
  {
    id: 'claude-code', label: 'Claude Code', group: 'recommended', popular: true,
    description: 'Claude 5 小时、每周与模型额度', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'CLAUDE_CODE_OAUTH_TOKEN', dashboardUrl: 'https://claude.ai/settings/usage',
    secretKind: 'OAuth Access Token',
    localHint: '优先复用 Claude Code 登录；如果新版 Claude 只把登录保存在系统钥匙串，可改用环境变量或本工具钥匙串。',
  },
  {
    id: 'kimi-code', label: 'Kimi Code', group: 'recommended', popular: true,
    description: '短周期、7 天与订阅总额度', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'KIMI_AUTH_TOKEN', dashboardUrl: 'https://www.kimi.com/code/console',
    secretKind: 'Kimi 登录令牌',
    localHint: '自动复用 Kimi Code CLI 登录；只有查看 Web 订阅总额度时才需要手动令牌。',
  },
  {
    id: 'cursor', label: 'Cursor', group: 'recommended', popular: true,
    description: '套餐 Credits、按需额度与账期', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'CURSOR_SESSION_COOKIE', dashboardUrl: 'https://cursor.com/dashboard?tab=usage',
    secretKind: 'Cursor Session Cookie',
    localHint: '自动读取 Cursor 桌面端登录；检测不到时，可粘贴 cursor.com 请求中的 Cookie。',
  },
  {
    id: 'copilot', label: 'GitHub Copilot', group: 'recommended', popular: true,
    description: 'Premium Requests、Chat 或按量计费状态', quotaSupport: 'automatic', quotaCoverage: 'best-effort',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'COPILOT_API_TOKEN', dashboardUrl: 'https://github.com/settings/copilot/features',
    secretKind: 'GitHub OAuth Token',
    accountMode: 'github-device',
    localHint: '推荐通过 GitHub 设备授权连接；可添加多个 GitHub 账户并随时切换查看额度。GitHub CLI 登录只作为兼容回退。',
  },
  {
    id: 'antigravity', label: 'Antigravity', group: 'recommended', popular: true,
    description: 'Gemini 与 Claude/GPT 的 5 小时和每周额度池', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'ANTIGRAVITY_OAUTH_CREDENTIALS_JSON',
    dashboardUrl: 'https://antigravity.google',
    secretKind: 'OAuth 凭据 JSON',
    localHint: '优先复用已运行的 Antigravity 或 agy 本机服务；也可复用 CodexBar OAuth，或提供 OAuth 凭据 JSON。',
  },
  {
    id: 'opencode', label: 'OpenCode Go', group: 'more', popular: true,
    description: '5 小时、每周与每月 Go 订阅额度', quotaSupport: 'manual',
    defaultAuthMode: 'keychain', authModes: ['environment', 'keychain'],
    defaultEnvironmentVariable: 'OPENCODE_SESSION_COOKIE', dashboardUrl: 'https://opencode.ai/auth',
    secretKind: 'OpenCode Go Session Cookie', extraFields: ['workspaceId'], accountMode: 'cookie-workspace-required',
    localHint: '每个账户独立保存名称、Cookie 与 Workspace ID；三项齐全后才会查询该账户额度。',
  },
  {
    id: 'qoder', label: 'Qoder', group: 'more', popular: true,
    description: '个人与共享 Big Model Credits', quotaSupport: 'manual',
    defaultAuthMode: 'environment', authModes: ['environment', 'keychain'],
    defaultEnvironmentVariable: 'QODER_SESSION_COOKIE', dashboardUrl: 'https://qoder.com/account/usage',
    secretKind: 'Qoder Session Cookie', extraFields: ['site'],
    localHint: '登录 Qoder 用量页后粘贴请求 Cookie；国际站和中国站可分别选择。',
  },
  {
    id: 'warp', label: 'Warp', group: 'more',
    description: '月度 Credits（部分账户不可读取）', quotaSupport: 'manual', quotaCoverage: 'best-effort',
    defaultAuthMode: 'environment', authModes: ['environment', 'keychain'],
    defaultEnvironmentVariable: 'WARP_API_KEY', dashboardUrl: 'https://app.warp.dev',
    secretKind: 'Warp API Key',
    localHint: 'Warp 目前需要 API Key，且部分账户不会返回可用额度。即使无法读取官方额度，本机 Token 仍可独立分析。',
  },
  {
    id: 'jetbrains-ai', label: 'JetBrains AI', group: 'more',
    description: '本机额度缓存（并非所有账户都有）', quotaSupport: 'automatic', quotaCoverage: 'best-effort',
    defaultAuthMode: 'local', authModes: ['local'],
    localHint: '尝试读取最近使用 IDE 的本地额度缓存；若 IDE 没有写入额度字段，仍会保留本机 Token 分析。',
    extraFields: ['customPath'],
  },
  {
    id: 'trae', label: 'Trae', group: 'unavailable', popular: true,
    description: '订阅额度暂不可查，能力持续评估中', quotaSupport: 'unavailable',
    defaultAuthMode: 'unavailable', authModes: ['unavailable'], dashboardUrl: 'https://www.trae.ai',
    localHint: 'Trae 尚未提供稳定、可验证的个人订阅额度接口。我们不会要求你提交账号密码，也不会显示猜测数据。',
  },
];

export const LIMIT_PROVIDER_IDS = LIMIT_PROVIDER_CATALOG.map((provider) => provider.id);
export const LIMIT_ENTITLEMENT_TYPES = ['unknown', 'paid', 'free', 'promotion', 'organization'];

// Kimi is the product's primary subscription view. Keep the rest of the order
// explicit so new providers never reshuffle a user's existing dashboard.
export const DEFAULT_LIMIT_PROVIDER_ORDER = [
  'kimi-code', 'codex', 'claude-code', 'cursor', 'copilot', 'antigravity',
  'opencode', 'qoder', 'warp', 'jetbrains-ai', 'trae',
];

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  refreshMinutes: 10,
  providerOrder: DEFAULT_LIMIT_PROVIDER_ORDER,
  providers: Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, {
    enabled: false,
    authMode: provider.defaultAuthMode,
    environmentVariable: provider.defaultEnvironmentVariable || '',
    customPath: '', workspaceId: '', site: 'international',
    accounts: [], activeAccountId: '',
    entitlementType: 'unknown',
    subscriptionPrice: null, subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '',
  }])),
});

function safeText(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeAccountId(value) {
  const id = safeText(value, 80);
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

function safeWorkspaceId(value) {
  const workspace = safeText(value, 1_024).match(/wrk_[A-Za-z0-9_-]+/)?.[0] || '';
  return workspace.slice(0, 240);
}

function normalizeSubscription(candidate) {
  const subscriptionPrice = candidate?.subscriptionPrice == null || candidate.subscriptionPrice === ''
    ? Number.NaN
    : Number(candidate.subscriptionPrice);
  const validPrice = Number.isFinite(subscriptionPrice) && subscriptionPrice > 0 && subscriptionPrice <= 1_000_000
    ? Math.round(subscriptionPrice * 100) / 100
    : null;
  const entitlementType = LIMIT_ENTITLEMENT_TYPES.includes(candidate?.entitlementType)
    ? candidate.entitlementType
    : validPrice != null ? 'paid' : 'unknown';
  const isPaid = entitlementType === 'paid';
  return {
    entitlementType,
    subscriptionPrice: isPaid ? validPrice : null,
    subscriptionCurrency: candidate?.subscriptionCurrency === 'cny' ? 'cny' : 'usd',
    billingCycle: candidate?.billingCycle === 'yearly' ? 'yearly' : 'monthly',
    renewsAt: isPaid && /^\d{4}-\d{2}-\d{2}$/.test(candidate?.renewsAt || '') ? candidate.renewsAt : '',
  };
}

function hasAccountSubscription(candidate) {
  return ['entitlementType', 'subscriptionPrice', 'subscriptionCurrency', 'billingCycle', 'renewsAt']
    .some((key) => Object.prototype.hasOwnProperty.call(candidate || {}, key));
}

function hasExplicitSubscription(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  return candidate.entitlementType && candidate.entitlementType !== 'unknown'
    || Number(candidate.subscriptionPrice) > 0
    || Boolean(candidate.renewsAt);
}

function normalizeAccounts(candidate, provider, legacySubscription) {
  if (!provider.accountMode || !Array.isArray(candidate?.accounts)) return [];
  const seen = new Set();
  const requestedActiveId = safeAccountId(candidate?.activeAccountId);
  const legacyAccountId = candidate.accounts.some((account) => safeAccountId(account?.id) === requestedActiveId)
    ? requestedActiveId
    : safeAccountId(candidate.accounts[0]?.id);
  return candidate.accounts.slice(0, 20).map((account, index) => {
    const id = safeAccountId(account?.id);
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const label = safeText(account?.label, 80)
      || (provider.id === 'opencode' ? '' : `Account ${index + 1}`);
    // OpenCode subscription metadata used to live on the provider. Migrate it
    // once to the active (or first) account so multi-account spend is not
    // duplicated. New account records always own their own subscription.
    const subscription = provider.id === 'opencode'
      ? hasAccountSubscription(account)
        ? normalizeSubscription(account)
        : id === legacyAccountId ? legacySubscription : normalizeSubscription(null)
      : {};
    return {
      id,
      label,
      externalIdentifier: safeText(account?.externalIdentifier, 160),
      workspaceId: provider.id === 'opencode' ? safeWorkspaceId(account?.workspaceId) : '',
      ...subscription,
    };
  }).filter(Boolean);
}

export function defaultLimitSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function normalizeLimitSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  const retiredGemini = input.providers?.['gemini-cli'];
  const providers = {};
  for (const provider of LIMIT_PROVIDER_CATALOG) {
    const candidate = input.providers?.[provider.id];
    const authMode = provider.authModes.includes(candidate?.authMode)
      ? candidate.authMode
      : provider.defaultAuthMode;
    // Before entitlementType existed, a positive entered price was the only
    // explicit evidence that an account was paid. Preserve that intent while
    // leaving price-less accounts unknown instead of guessing "free".
    // Gemini CLI's consumer quota surface was retired. Preserve only the
    // user's declared benefit classification on Antigravity when that card has
    // no newer declaration; never copy credentials, quota history, or silently
    // enable the replacement provider.
    const subscriptionCandidate = provider.id === 'antigravity'
      && !hasExplicitSubscription(candidate) && hasExplicitSubscription(retiredGemini)
      ? retiredGemini : candidate;
    const legacySubscription = normalizeSubscription(subscriptionCandidate);
    const accounts = normalizeAccounts(candidate, provider, legacySubscription);
    const subscription = provider.id === 'opencode' ? normalizeSubscription(null) : legacySubscription;
    const activeAccountId = safeAccountId(candidate?.activeAccountId);
    providers[provider.id] = {
      enabled: provider.quotaSupport !== 'unavailable' && candidate?.enabled === true,
      authMode,
      environmentVariable: safeText(candidate?.environmentVariable || provider.defaultEnvironmentVariable, 80),
      customPath: safeText(candidate?.customPath, 1_024),
      // Only persist the non-secret wrk_ identifier. This intentionally drops
      // cookies accidentally pasted into the old Workspace field.
      workspaceId: provider.id === 'opencode' ? safeWorkspaceId(candidate?.workspaceId) : safeText(candidate?.workspaceId, 240),
      site: candidate?.site === 'china' ? 'china' : 'international',
      accounts,
      activeAccountId: accounts.some((account) => account.id === activeAccountId)
        ? activeAccountId
        : accounts[0]?.id || '',
      ...subscription,
    };
  }
  const refreshMinutes = Number(input.refreshMinutes);
  const requestedOrder = Array.isArray(input.providerOrder)
    ? input.providerOrder.map((id) => id === 'gemini-cli' ? 'antigravity' : id)
    : [];
  const providerOrder = [...new Set([
    ...requestedOrder.filter((id) => LIMIT_PROVIDER_IDS.includes(id)),
    ...DEFAULT_LIMIT_PROVIDER_ORDER,
    ...LIMIT_PROVIDER_IDS,
  ])];
  return {
    enabled: input.enabled === true,
    refreshMinutes: Number.isInteger(refreshMinutes) && refreshMinutes >= 5 && refreshMinutes <= 60
      ? refreshMinutes
      : DEFAULT_SETTINGS.refreshMinutes,
    providerOrder,
    providers,
  };
}

export function publicLimitSettings(settings, {
  keychainAvailable = process.platform === 'darwin', hasSecret = () => false, detections = {},
} = {}) {
  const normalized = normalizeLimitSettings(settings);
  const catalogById = new Map(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, provider]));
  const providers = Object.fromEntries(Object.entries(normalized.providers).map(([id, provider]) => [id, {
    ...provider,
    customPath: safeLocalPathDisplay(provider.customPath),
    customPathConfigured: Boolean(provider.customPath),
    workspaceId: safeLocalPathDisplay(provider.workspaceId),
    accounts: provider.accounts.map((account) => ({
      ...account,
      hasSecret: hasSecret(`${id}:${account.id}`),
    })),
  }]));
  return {
    ...normalized,
    providers,
    keychainAvailable,
    catalog: normalized.providerOrder.map((id) => catalogById.get(id)).filter(Boolean).map((provider) => ({
      ...provider,
      hasSecret: hasSecret(provider.id),
      accountCount: providers[provider.id]?.accounts?.length || 0,
      supportsKeychain: keychainAvailable && provider.authModes.includes('keychain'),
      detection: detections[provider.id] || {
        state: provider.quotaSupport === 'unavailable' ? 'unavailable' : 'not_detected',
        label: provider.quotaSupport === 'unavailable' ? '额度暂不可查' : '尚未检测',
      },
    })),
  };
}
