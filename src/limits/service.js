import { randomUUID } from 'node:crypto';
import { loadConfig, saveConfig } from '../config.js';
import {
  defaultLimitSettings, LIMIT_PROVIDER_CATALOG, normalizeLimitSettings, publicLimitSettings,
} from './catalog.js';
import {
  deleteKeychainSecret, environmentSecret, keychainAvailable, loadAntigravityCredentials,
  loadClaudeCredentials, loadCodexCredentials, loadCopilotCredentials, loadCursorCredentials,
  loadKimiCredentials, providerAccountCredentialKey,
  readKeychainSecret, writeKeychainSecret,
} from './credentials.js';
import { detectJetBrainsQuotaFile } from './providers/jetbrains.js';
import { fetchClaudeLimits } from './providers/claude.js';
import { fetchCodexLimits } from './providers/codex.js';
import {
  fetchCopilotIdentity, fetchCopilotLimits, pollCopilotDeviceToken, requestCopilotDeviceCode,
} from './providers/copilot.js';
import { fetchCursorLimits } from './providers/cursor.js';
import { fetchAntigravityLimits } from './providers/antigravity.js';
import { fetchDeepSeekLimits } from './providers/deepseek.js';
import { detectAntigravityLocalRuntime } from './providers/antigravity-local.js';
import { fetchJetBrainsLimits } from './providers/jetbrains.js';
import { fetchKimiLimits } from './providers/kimi.js';
import { fetchOpenCodeGoLimits } from './providers/opencode.js';
import { fetchQoderLimits } from './providers/qoder.js';
import { fetchWarpLimits } from './providers/warp.js';
import { loadLimitHistory, recordLimitSnapshot } from './history.js';
import { assertProviderContract } from './contract.js';
import { safeLocalPathDisplay } from '../safe-display.js';

const FETCHERS = {
  codex: fetchCodexLimits,
  'claude-code': fetchClaudeLimits,
  'kimi-code': fetchKimiLimits,
  cursor: fetchCursorLimits,
  copilot: fetchCopilotLimits,
  warp: fetchWarpLimits,
  opencode: fetchOpenCodeGoLimits,
  qoder: fetchQoderLimits,
  antigravity: fetchAntigravityLimits,
  deepseek: fetchDeepSeekLimits,
  'jetbrains-ai': fetchJetBrainsLimits,
};

let cachedResult = null;
let cacheKey = '';
let cacheExpiresAt = 0;
let inFlight = null;

function providerError(provider, error) {
  const knownCodes = new Set([
    'not_configured', 'unauthorized', 'timeout', 'network_error', 'provider_error',
    'invalid_response', 'blocked_endpoint', 'workspace_unavailable',
  ]);
  return {
    id: provider.id,
    label: provider.label,
    status: 'error',
    error: {
      code: knownCodes.has(error?.code) ? error.code : 'provider_error',
      message: {
        not_configured: `${provider.label} 尚未配置，或未检测到可用登录。`,
        unauthorized: `${provider.label} 登录已失效，或无权读取额度。`,
        timeout: `${provider.label} 额度查询超时，请稍后重试。`,
        network_error: `${provider.label} 暂时无法连接，请检查网络后重试。`,
        invalid_response: `${provider.label} 返回了无法验证的额度数据。`,
        blocked_endpoint: `${provider.label} 当前不允许此额度查询。`,
        workspace_unavailable: `${provider.label} 未发现可读取的 Go Workspace 或订阅窗口。`,
        provider_error: `${provider.label} 额度查询失败，请稍后重试。`,
      }[knownCodes.has(error?.code) ? error.code : 'provider_error'],
    },
    windows: [],
    quotaCoverage: provider.quotaCoverage || 'supported',
    updatedAt: new Date().toISOString(),
  };
}

function accountResult(provider, account, value) {
  return {
    ...value,
    account: value.account || account.label,
    accountId: account.id,
    accountLabel: account.label,
    quotaCoverage: provider.quotaCoverage || 'supported',
  };
}

function accountSettings(providerId, settings, account) {
  return {
    ...settings,
    authMode: 'keychain',
    credentialKey: providerAccountCredentialKey(providerId, account.id),
    accountId: account.id,
    accountLabel: account.label,
    workspaceId: account.workspaceId || '',
  };
}

export function getLimitSettings(config = loadConfig()) {
  return normalizeLimitSettings(config?.subscriptionLimits || defaultLimitSettings());
}

function detected(state, label, detail = '') {
  return { state, label, detail };
}

function detectLocalProvider(providerId, providerSettings, environment, options = {}) {
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
      if (providerSettings.accounts?.length) {
        return detected('configured', `${providerSettings.accounts.length} 个 GitHub 账户已连接`);
      }
      const value = loadCopilotCredentials(environment);
      return value.found ? detected('detected', `已检测到 ${value.source || 'GitHub 登录'}`)
        : detected('needs_login', '未检测到 GitHub CLI 登录', '推荐运行 gh auth login');
    }
    if (providerId === 'antigravity') {
      const runtime = detectAntigravityLocalRuntime({ run: options.run, platform: options.platform });
      if (runtime.found) return detected('detected', `已检测到 ${runtime.label}`, '将优先读取 127.0.0.1 本机额度接口');
      const value = loadAntigravityCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Antigravity OAuth')
        : value.found ? detected('expired', 'Antigravity 登录已过期')
          : detected('not_detected', '未检测到 Antigravity 或 agy', '请先启动并登录 Antigravity，或运行 agy');
    }
    if (providerId === 'jetbrains-ai') {
      return detectJetBrainsQuotaFile(providerSettings.customPath)
        ? detected('detected', '已检测到 JetBrains AI 配置')
        : detected('not_detected', '未检测到 AI Assistant 配置');
    }
  } catch {
    return detected('not_detected', '自动检测失败', '仍可选择手动凭据');
  }
  return null;
}

function providerDetection(provider, settings, { environment, hasKeychainSecret, hasSecret, run, platform }) {
  if (provider.quotaSupport === 'unavailable') return detected('unavailable', '订阅额度暂不可查');
  const local = detectLocalProvider(provider.id, settings, environment, { run, platform });
  if (local?.state === 'detected') return local;
  if (provider.id === 'opencode') {
    if (settings.accounts?.length) {
      const ready = settings.accounts.filter((account) => (
        Boolean(account.label && account.workspaceId)
        && hasSecret(providerAccountCredentialKey(provider.id, account.id))
      )).length;
      return ready === settings.accounts.length
        ? detected('configured', `${ready} 个 OpenCode Go 账户已配置`)
        : detected('manual', `${ready}/${settings.accounts.length} 个 OpenCode Go 账户已配置`, '每个账户都需要名称、Cookie 与 Workspace ID');
    }
    return detected('manual', '需要连接 OpenCode Go 账户', '添加账户并填写名称、Cookie 与 Workspace ID');
  }
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
  const readSecret = options.readSecret || readKeychainSecret;
  const hasSecret = options.hasSecret
    || ((credentialKey) => {
      const providerId = String(credentialKey || '').split(':', 1)[0];
      return keychainProviders.has(providerId) && Boolean(readSecret(credentialKey));
    });
  const secretStates = Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, hasSecret(provider.id)]));
  const detections = options.detections || Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id,
    providerDetection(provider, settings.providers[provider.id], {
      environment, hasKeychainSecret: secretStates[provider.id], hasSecret,
      run: options.run, platform: options.platform,
    }),
  ]));
  return publicLimitSettings(settings, {
    keychainAvailable: options.keychainAvailable ?? keychainAvailable(),
    hasSecret, detections,
  });
}

export function saveLimitSettings(payload, {
  config = loadConfig() || {},
  writeSecret = writeKeychainSecret,
  deleteSecret = deleteKeychainSecret,
  save = saveConfig,
} = {}) {
  const incoming = payload?.settings || payload;
  const current = getLimitSettings(config);
  const mergedProviders = Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => {
    const candidate = incoming?.providers?.[provider.id];
    if (!candidate || typeof candidate !== 'object') return [provider.id, candidate];
    const prior = current.providers[provider.id];
    const hasCustomPath = Object.prototype.hasOwnProperty.call(candidate, 'customPath');
    const hasWorkspaceId = Object.prototype.hasOwnProperty.call(candidate, 'workspaceId');
    const customPath = !hasCustomPath || candidate.customPath === safeLocalPathDisplay(prior.customPath)
      ? prior.customPath : candidate.customPath;
    const workspaceId = !hasWorkspaceId || candidate.workspaceId === safeLocalPathDisplay(prior.workspaceId)
      ? prior.workspaceId : candidate.workspaceId;
    return [provider.id, { ...candidate, customPath, workspaceId }];
  }));
  const settings = normalizeLimitSettings({ ...incoming, providers: mergedProviders });
  const secrets = payload?.secrets && typeof payload.secrets === 'object' ? payload.secrets : {};
  const accountSecrets = payload?.accountSecrets && typeof payload.accountSecrets === 'object'
    ? payload.accountSecrets : {};
  const clearSecrets = new Set(Array.isArray(payload?.clearSecrets) ? payload.clearSecrets : []);
  const clearAccountSecrets = new Set(Array.isArray(payload?.clearAccountSecrets)
    ? payload.clearAccountSecrets : []);
  for (const provider of LIMIT_PROVIDER_CATALOG) {
    if (clearSecrets.has(provider.id)) deleteSecret(provider.id);
    if (typeof secrets[provider.id] === 'string' && secrets[provider.id].trim()) {
      if (!provider.authModes.includes('keychain')) throw new Error(`${provider.label} 不支持手动钥匙串凭据。`);
      writeSecret(provider.id, secrets[provider.id]);
    }
    const priorAccounts = new Set(current.providers[provider.id]?.accounts?.map((account) => account.id) || []);
    const nextAccounts = new Set(settings.providers[provider.id]?.accounts?.map((account) => account.id) || []);
    for (const accountId of priorAccounts) {
      if (!nextAccounts.has(accountId)) deleteSecret(providerAccountCredentialKey(provider.id, accountId));
    }
    for (const account of settings.providers[provider.id]?.accounts || []) {
      const key = providerAccountCredentialKey(provider.id, account.id);
      if (clearAccountSecrets.has(key)) deleteSecret(key);
      const secret = accountSecrets?.[provider.id]?.[account.id];
      if (typeof secret === 'string' && secret.trim()) writeSecret(key, secret);
    }
  }
  save({ ...config, subscriptionLimits: settings });
  clearLimitCache();
  return getPublicLimitSettings({ ...config, subscriptionLimits: settings });
}

export function createCopilotDeviceController({
  fetcher = fetch,
  requestCode = requestCopilotDeviceCode,
  pollToken = pollCopilotDeviceToken,
  identityLoader = fetchCopilotIdentity,
  configLoader = loadConfig,
  configSaver = saveConfig,
  secretWriter = writeKeychainSecret,
  now = () => Date.now(),
} = {}) {
  let pending = null;

  const publicState = () => {
    if (!pending) return { status: 'idle' };
    return {
      status: pending.status,
      userCode: pending.userCode,
      verificationUri: pending.verificationUri,
      expiresAt: new Date(pending.expiresAt).toISOString(),
      intervalSeconds: Math.ceil(pending.intervalMs / 1_000),
      message: pending.message || null,
    };
  };

  const storeAccount = (token, identity) => {
    const config = configLoader() || {};
    const settings = getLimitSettings(config);
    const provider = settings.providers.copilot;
    const externalIdentifier = identity.id || identity.login || '';
    const existing = provider.accounts.find((account) => (
      externalIdentifier && account.externalIdentifier === externalIdentifier
    ));
    const id = existing?.id || randomUUID();
    const label = identity.login || existing?.label || `GitHub ${provider.accounts.length + 1}`;
    const account = { id, label, externalIdentifier, workspaceId: '' };
    const accounts = existing
      ? provider.accounts.map((value) => value.id === id ? account : value)
      : [...provider.accounts, account];
    secretWriter(providerAccountCredentialKey('copilot', id), token);
    const next = normalizeLimitSettings({
      ...settings,
      enabled: true,
      providers: {
        ...settings.providers,
        copilot: { ...provider, enabled: true, authMode: 'keychain', accounts, activeAccountId: id },
      },
    });
    configSaver({ ...config, subscriptionLimits: next });
    clearLimitCache();
    return { id, label, accountCount: accounts.length };
  };

  return async function copilotDeviceAction(payload = {}) {
    const action = String(payload.action || 'status');
    if (pending && now() >= pending.expiresAt) pending = null;
    if (action === 'status') return publicState();
    if (action === 'cancel') { pending = null; return publicState(); }
    if (action === 'start') {
      try {
        const code = await requestCode({ fetcher });
        const startedAt = now();
        pending = {
          ...code, status: 'pending', expiresAt: startedAt + code.expiresIn * 1_000,
          intervalMs: code.interval * 1_000, nextPollAt: startedAt,
        };
        return publicState();
      } catch {
        return { status: 'error', message: '无法启动 GitHub 设备授权，请检查网络后重试。' };
      }
    }
    if (action !== 'poll' || !pending) return { status: 'idle' };
    if (now() < pending.nextPollAt) return publicState();
    try {
      const result = await pollToken({
        deviceCode: pending.deviceCode, clientId: pending.clientId, fetcher,
      });
      if (result.status === 'pending') {
        if (result.slowDown) pending.intervalMs += 5_000;
        pending.nextPollAt = now() + pending.intervalMs;
        return publicState();
      }
      const identity = await identityLoader(result.token, { fetcher });
      const account = storeAccount(result.token, identity);
      pending = null;
      return { status: 'connected', account };
    } catch (error) {
      pending = null;
      return { status: 'error', message: error?.message || 'GitHub 设备授权失败，请重试。' };
    }
  };
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
      const configuredAccounts = settings.providers[provider.id]?.accounts || [];
      if (provider.accountMode && configuredAccounts.length) {
        const accounts = await Promise.all(configuredAccounts.map(async (account) => {
          try {
            if (provider.id === 'opencode' && (!account.label || !account.workspaceId)) {
              const error = new Error('OpenCode Go 账户需要名称、Cookie 与 Workspace ID 才能查询额度。');
              error.code = 'not_configured';
              throw error;
            }
            const result = await fetchProvider({
              settings: accountSettings(provider.id, settings.providers[provider.id], account),
              environment: options.environment || process.env,
              fetcher: options.fetcher || fetch,
              run: options.run, platform: options.platform, localRequester: options.localRequester,
            });
            return accountResult(provider, account, assertProviderContract(provider.id, result));
          } catch (error) {
            return accountResult(provider, account, providerError(provider, error));
          }
        }));
        const activeId = settings.providers[provider.id].activeAccountId;
        const active = accounts.find((account) => account.accountId === activeId) || accounts[0];
        return {
          ...active,
          id: provider.id,
          label: provider.label,
          accounts,
          activeAccountId: active.accountId,
          quotaCoverage: provider.quotaCoverage || 'supported',
        };
      }
      const result = await fetchProvider({
        settings: settings.providers[provider.id],
        environment: options.environment || process.env,
        fetcher: options.fetcher || fetch,
        run: options.run, platform: options.platform, localRequester: options.localRequester,
      });
      return {
        ...assertProviderContract(provider.id, result),
        label: provider.label,
        quotaCoverage: provider.quotaCoverage || 'supported',
      };
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
