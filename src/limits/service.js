import { loadConfig, saveConfig } from '../config.js';
import {
  defaultLimitSettings, LIMIT_PROVIDER_CATALOG, normalizeLimitSettings, publicLimitSettings,
} from './catalog.js';
import {
  deleteKeychainSecret, environmentSecret, keychainAvailable, loadAntigravityCredentials,
  loadClaudeCredentials, loadCodexCredentials, loadCopilotCredentials, loadCursorCredentials,
  loadGeminiCredentials, loadKimiCredentials, readKeychainSecret, writeKeychainSecret,
} from './credentials.js';
import { detectJetBrainsQuotaFile } from './providers/jetbrains.js';
import { fetchClaudeLimits } from './providers/claude.js';
import { fetchCodexLimits } from './providers/codex.js';
import { fetchCopilotLimits } from './providers/copilot.js';
import { fetchCursorLimits } from './providers/cursor.js';
import { fetchGeminiLimits } from './providers/gemini.js';
import { fetchAntigravityLimits } from './providers/antigravity.js';
import { fetchJetBrainsLimits } from './providers/jetbrains.js';
import { fetchKimiLimits } from './providers/kimi.js';
import { fetchOpenCodeLimits } from './providers/opencode.js';
import { fetchQoderLimits } from './providers/qoder.js';
import { fetchWarpLimits } from './providers/warp.js';
import { detectWindsurfDatabase, fetchWindsurfLimits } from './providers/windsurf.js';
import { loadLimitHistory, recordLimitSnapshot } from './history.js';

const FETCHERS = {
  codex: fetchCodexLimits,
  'claude-code': fetchClaudeLimits,
  'kimi-code': fetchKimiLimits,
  cursor: fetchCursorLimits,
  copilot: fetchCopilotLimits,
  warp: fetchWarpLimits,
  'gemini-cli': fetchGeminiLimits,
  opencode: fetchOpenCodeLimits,
  qoder: fetchQoderLimits,
  antigravity: fetchAntigravityLimits,
  'jetbrains-ai': fetchJetBrainsLimits,
  windsurf: fetchWindsurfLimits,
};

let cachedResult = null;
let cacheKey = '';
let cacheExpiresAt = 0;
let inFlight = null;

function providerError(provider, error) {
  const knownCodes = new Set([
    'not_configured', 'unauthorized', 'timeout', 'network_error', 'provider_error',
    'invalid_response', 'blocked_endpoint',
  ]);
  return {
    id: provider.id,
    label: provider.label,
    status: 'error',
    error: {
      code: knownCodes.has(error?.code) ? error.code : 'provider_error',
      message: String(error?.message || '额度查询失败。').slice(0, 300),
    },
    windows: [],
    quotaCoverage: provider.quotaCoverage || 'supported',
    updatedAt: new Date().toISOString(),
  };
}

export function getLimitSettings(config = loadConfig()) {
  return normalizeLimitSettings(config?.subscriptionLimits || defaultLimitSettings());
}

function detected(state, label, detail = '') {
  return { state, label, detail };
}

function detectLocalProvider(providerId, providerSettings, environment) {
  try {
    if (providerId === 'codex') {
      const value = loadCodexCredentials(environment);
      return value.found ? detected('detected', '已检测到 Codex 登录') : detected('needs_login', '请先登录 Codex CLI', '运行 codex 并完成登录');
    }
    if (providerId === 'claude-code') {
      const value = loadClaudeCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Claude Code 登录')
        : value.found ? detected('expired', 'Claude 登录已过期', '运行 claude 重新登录')
          : detected('needs_login', '请先登录 Claude Code', '运行 claude 并完成登录');
    }
    if (providerId === 'kimi-code') {
      const value = loadKimiCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Kimi Code 登录')
        : value.found ? detected('expired', 'Kimi 登录已过期') : detected('needs_login', '请先登录 Kimi Code');
    }
    if (providerId === 'cursor') {
      const value = loadCursorCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Cursor 桌面端登录')
        : value.found ? detected('expired', 'Cursor 登录已过期', '在 Cursor 桌面端重新登录')
          : detected('needs_login', '未检测到 Cursor 登录', '打开 Cursor 桌面端并登录');
    }
    if (providerId === 'copilot') {
      const value = loadCopilotCredentials(environment);
      return value.found ? detected('detected', `已检测到 ${value.source || 'GitHub 登录'}`)
        : detected('needs_login', '未检测到 GitHub CLI 登录', '推荐运行 gh auth login');
    }
    if (providerId === 'gemini-cli') {
      const value = loadGeminiCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Gemini CLI 登录')
        : value.found ? detected('expired', 'Gemini 登录已过期') : detected('needs_login', '请先登录 Gemini CLI');
    }
    if (providerId === 'antigravity') {
      const value = loadAntigravityCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Antigravity OAuth')
        : value.found ? detected('expired', 'Antigravity 登录已过期') : detected('not_detected', '未检测到 Antigravity OAuth');
    }
    if (providerId === 'jetbrains-ai') {
      return detectJetBrainsQuotaFile(providerSettings.customPath)
        ? detected('detected', '已检测到 JetBrains AI 配置')
        : detected('not_detected', '未检测到 AI Assistant 配置');
    }
    if (providerId === 'windsurf') {
      return detectWindsurfDatabase(providerSettings.customPath, { environment })
        ? detected('detected', '已检测到 Windsurf 本地额度缓存')
        : detected('not_detected', '未检测到 Windsurf 缓存', '请先打开并登录 Windsurf');
    }
  } catch {
    return detected('not_detected', '自动检测失败', '仍可选择手动凭据');
  }
  return null;
}

function providerDetection(provider, settings, { environment, hasKeychainSecret }) {
  if (provider.quotaSupport === 'unavailable') return detected('unavailable', '订阅额度暂不可查');
  const local = detectLocalProvider(provider.id, settings, environment);
  if (local?.state === 'detected') return local;
  const variable = settings.environmentVariable || provider.defaultEnvironmentVariable;
  if (variable && environmentSecret(variable, environment)) return detected('configured', `已配置环境变量 ${variable}`);
  if (hasKeychainSecret) return detected('configured', '已安全保存到 macOS 钥匙串');
  return local || detected('manual', '需要一次手动连接');
}

export function getPublicLimitSettings(config = loadConfig(), options = {}) {
  const settings = getLimitSettings(config);
  const environment = options.environment || process.env;
  const keychainProviders = new Set(LIMIT_PROVIDER_CATALOG
    .filter((provider) => provider.authModes.includes('keychain')).map((provider) => provider.id));
  const hasSecret = options.hasSecret
    || ((providerId) => keychainProviders.has(providerId) && Boolean(readKeychainSecret(providerId)));
  const secretStates = Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, hasSecret(provider.id)]));
  const detections = options.detections || Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id,
    providerDetection(provider, settings.providers[provider.id], {
      environment, hasKeychainSecret: secretStates[provider.id],
    }),
  ]));
  return publicLimitSettings(settings, {
    keychainAvailable: options.keychainAvailable ?? keychainAvailable(),
    hasSecret: (providerId) => secretStates[providerId], detections,
  });
}

export function saveLimitSettings(payload, {
  config = loadConfig() || {},
  writeSecret = writeKeychainSecret,
  deleteSecret = deleteKeychainSecret,
} = {}) {
  const settings = normalizeLimitSettings(payload?.settings || payload);
  const secrets = payload?.secrets && typeof payload.secrets === 'object' ? payload.secrets : {};
  const clearSecrets = new Set(Array.isArray(payload?.clearSecrets) ? payload.clearSecrets : []);
  for (const provider of LIMIT_PROVIDER_CATALOG) {
    if (clearSecrets.has(provider.id)) deleteSecret(provider.id);
    if (typeof secrets[provider.id] === 'string' && secrets[provider.id].trim()) {
      if (!provider.authModes.includes('keychain')) throw new Error(`${provider.label} 不支持手动钥匙串凭据。`);
      writeSecret(provider.id, secrets[provider.id]);
    }
  }
  saveConfig({ ...config, subscriptionLimits: settings });
  clearLimitCache();
  return settings;
}

export function clearLimitCache() {
  cachedResult = null;
  cacheKey = '';
  cacheExpiresAt = 0;
}

async function fetchEnabled(settings, options = {}) {
  const catalogById = new Map(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, provider]));
  const enabled = settings.providerOrder
    .map((id) => catalogById.get(id))
    .filter((provider) => provider && settings.providers[provider.id]?.enabled);
  const providers = await Promise.all(enabled.map(async (provider) => {
    const fetchProvider = options.fetchers?.[provider.id] || FETCHERS[provider.id];
    try {
      if (!fetchProvider) throw Object.assign(new Error(`${provider.label} 暂不支持订阅额度查询。`), { code: 'not_configured' });
      const result = await fetchProvider({
        settings: settings.providers[provider.id],
        environment: options.environment || process.env,
        fetcher: options.fetcher || fetch,
      });
      return { ...result, quotaCoverage: provider.quotaCoverage || 'supported' };
    } catch (error) {
      return providerError(provider, error);
    }
  }));
  const now = new Date();
  return {
    schemaVersion: 1,
    enabled: true,
    generatedAt: now.toISOString(),
    refreshMinutes: settings.refreshMinutes,
    providers,
    summary: {
      configured: enabled.length,
      available: providers.filter((provider) => provider.status === 'ok').length,
      needsAttention: providers.filter((provider) => provider.status === 'error').length,
      nextResetAt: providers.flatMap((provider) => provider.windows || [])
        .map((window) => window.resetsAt).filter((value) => value && new Date(value) > now).sort()[0] || null,
    },
    privacy: {
      credentialsInBrowser: false,
      includedInExports: false,
      includedInCommunitySync: false,
      networkOnlyWhenEnabled: true,
    },
  };
}

export async function loadSubscriptionLimits({ force = false, config = loadConfig(), ...options } = {}) {
  const settings = getLimitSettings(config);
  const historyLoader = options.historyLoader || loadLimitHistory;
  const historyRecorder = options.historyRecorder || recordLimitSnapshot;
  const history = () => {
    try { return historyLoader(); } catch { return { schemaVersion: 1, observations: [] }; }
  };
  if (!settings.enabled) {
    return {
      schemaVersion: 1, enabled: false, generatedAt: new Date().toISOString(),
      refreshMinutes: settings.refreshMinutes, providers: [],
      summary: { configured: 0, available: 0, needsAttention: 0, nextResetAt: null },
      history: history(),
      privacy: {
        credentialsInBrowser: false, includedInExports: false,
        includedInCommunitySync: false, networkOnlyWhenEnabled: true,
      },
    };
  }
  const nextKey = JSON.stringify(settings);
  if (!force && cachedResult && cacheKey === nextKey && Date.now() < cacheExpiresAt) return cachedResult;
  if (!force && inFlight) return inFlight;
  inFlight = fetchEnabled(settings, options)
    .then((result) => {
      try { historyRecorder(result); } catch { /* Quota display must survive history I/O failures. */ }
      cachedResult = { ...result, history: history() };
      cacheKey = nextKey;
      cacheExpiresAt = Date.now() + settings.refreshMinutes * 60_000;
      return cachedResult;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}
