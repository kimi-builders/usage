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
    description: 'Premium Requests、Chat 与月度重置', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'COPILOT_API_TOKEN', dashboardUrl: 'https://github.com/settings/copilot/features',
    secretKind: 'GitHub OAuth Token',
    localHint: '优先复用 GitHub CLI（gh）登录；也可提供具备 Copilot 权限的 GitHub OAuth Token。',
  },
  {
    id: 'gemini-cli', label: 'Gemini CLI', group: 'recommended', popular: true,
    description: 'Gemini 模型级剩余额度与重置时间', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local'], dashboardUrl: 'https://aistudio.google.com/usage',
    localHint: '自动复用 Gemini CLI OAuth 登录。',
  },
  {
    id: 'opencode', label: 'OpenCode', group: 'more', popular: true,
    description: '5 小时滚动与每周订阅额度', quotaSupport: 'manual',
    defaultAuthMode: 'environment', authModes: ['environment', 'keychain'],
    defaultEnvironmentVariable: 'OPENCODE_SESSION_COOKIE', dashboardUrl: 'https://opencode.ai',
    secretKind: 'OpenCode Session Cookie', extraFields: ['workspaceId'],
    localHint: 'OpenCode 暂不向本机 CLI 暴露订阅额度凭据；登录 opencode.ai 后粘贴 auth Cookie，可选填 Workspace 链接。',
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
    id: 'antigravity', label: 'Antigravity', group: 'more',
    description: 'Gemini 与 Claude/GPT 模型额度池', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local', 'environment', 'keychain'],
    defaultEnvironmentVariable: 'ANTIGRAVITY_OAUTH_CREDENTIALS_JSON',
    secretKind: 'OAuth 凭据 JSON',
    localHint: '可复用 ~/.codexbar/antigravity/oauth_creds.json，或提供 OAuth 凭据 JSON。',
  },
  {
    id: 'warp', label: 'Warp', group: 'more',
    description: '月度 Credits 与附加 Credits', quotaSupport: 'manual',
    defaultAuthMode: 'environment', authModes: ['environment', 'keychain'],
    defaultEnvironmentVariable: 'WARP_API_KEY', dashboardUrl: 'https://app.warp.dev',
    secretKind: 'Warp API Key',
    localHint: 'Warp 目前需要 API Key；建议保存到 macOS 钥匙串。',
  },
  {
    id: 'jetbrains-ai', label: 'JetBrains AI', group: 'more',
    description: 'AI Credits 与下次补充时间', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local'],
    localHint: '自动读取最近使用 IDE 的本地 AIAssistantQuotaManager2.xml。',
    extraFields: ['customPath'],
  },
  {
    id: 'trae', label: 'Trae', group: 'unavailable', popular: true,
    description: '订阅额度暂不可查，能力持续评估中', quotaSupport: 'unavailable',
    defaultAuthMode: 'unavailable', authModes: ['unavailable'], dashboardUrl: 'https://www.trae.ai',
    localHint: 'Trae 尚未提供稳定、可验证的个人订阅额度接口。我们不会要求你提交账号密码，也不会显示猜测数据。',
  },
  {
    id: 'windsurf', label: 'Windsurf', group: 'more', popular: true,
    description: '每日、每周或消息额度（本机缓存）', quotaSupport: 'automatic',
    defaultAuthMode: 'local', authModes: ['local'], dashboardUrl: 'https://windsurf.com/subscription/usage',
    localHint: '自动读取 Windsurf 本机额度缓存，不需要 Cookie；先打开并登录 Windsurf 让缓存更新。',
  },
];

export const LIMIT_PROVIDER_IDS = LIMIT_PROVIDER_CATALOG.map((provider) => provider.id);

// Kimi is the product's primary subscription view. Keep the rest of the order
// explicit so new providers never reshuffle a user's existing dashboard.
export const DEFAULT_LIMIT_PROVIDER_ORDER = [
  'kimi-code', 'codex', 'claude-code', 'cursor', 'copilot', 'gemini-cli',
  'opencode', 'qoder', 'antigravity', 'warp', 'jetbrains-ai', 'windsurf', 'trae',
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
    subscriptionPrice: null, subscriptionCurrency: 'usd', billingCycle: 'monthly', renewsAt: '',
  }])),
});

function safeText(value, maxLength = 240) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function defaultLimitSettings() {
  return structuredClone(DEFAULT_SETTINGS);
}

export function normalizeLimitSettings(value) {
  const input = value && typeof value === 'object' ? value : {};
  const providers = {};
  for (const provider of LIMIT_PROVIDER_CATALOG) {
    const candidate = input.providers?.[provider.id];
    const authMode = provider.authModes.includes(candidate?.authMode)
      ? candidate.authMode
      : provider.defaultAuthMode;
    const subscriptionPrice = candidate?.subscriptionPrice == null || candidate.subscriptionPrice === ''
      ? Number.NaN
      : Number(candidate.subscriptionPrice);
    providers[provider.id] = {
      enabled: provider.quotaSupport !== 'unavailable' && candidate?.enabled === true,
      authMode,
      environmentVariable: safeText(candidate?.environmentVariable || provider.defaultEnvironmentVariable, 80),
      customPath: safeText(candidate?.customPath, 1_024),
      workspaceId: safeText(candidate?.workspaceId, 240),
      site: candidate?.site === 'china' ? 'china' : 'international',
      subscriptionPrice: Number.isFinite(subscriptionPrice) && subscriptionPrice > 0 && subscriptionPrice <= 1_000_000
        ? Math.round(subscriptionPrice * 100) / 100
        : null,
      subscriptionCurrency: candidate?.subscriptionCurrency === 'cny' ? 'cny' : 'usd',
      billingCycle: candidate?.billingCycle === 'yearly' ? 'yearly' : 'monthly',
      renewsAt: /^\d{4}-\d{2}-\d{2}$/.test(candidate?.renewsAt || '') ? candidate.renewsAt : '',
    };
  }
  const refreshMinutes = Number(input.refreshMinutes);
  const requestedOrder = Array.isArray(input.providerOrder) ? input.providerOrder : [];
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
  return {
    ...normalized,
    keychainAvailable,
    catalog: normalized.providerOrder.map((id) => catalogById.get(id)).filter(Boolean).map((provider) => ({
      ...provider,
      hasSecret: hasSecret(provider.id),
      supportsKeychain: keychainAvailable && provider.authModes.includes('keychain'),
      detection: detections[provider.id] || {
        state: provider.quotaSupport === 'unavailable' ? 'unavailable' : 'not_detected',
        label: provider.quotaSupport === 'unavailable' ? '额度暂不可查' : '尚未检测',
      },
    })),
  };
}
