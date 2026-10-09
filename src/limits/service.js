import { randomUUID } from 'node:crypto';
import { createSessionSalt, loadConfig, saveConfig } from '../config.js';
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
import { fetchKiroLimits, loadKiroCredentials } from './providers/kiro.js';
import { fetchOpenCodeGoLimits, readLocalGoKey } from './providers/opencode.js';
import { fetchQoderLimits } from './providers/qoder.js';
import { fetchWarpLimits } from './providers/warp.js';
import { fetchWorkBuddyLimits, parseWorkBuddyCredential } from './providers/workbuddy.js';
import { fetchGlmLimits } from './providers/glm.js';
import { fetchMiniMaxLimits } from './providers/minimax.js';
import { fetchAlibabaCodingLimits } from './providers/alibaba-coding.js';
import { REGIONAL_PLAN_IDS, regionalCredentialKey } from './providers/coding-plan-common.js';
import { loadLimitHistory, recordLimitSnapshot } from './history.js';
import { assertProviderContract } from './contract.js';
import { safeLocalPathDisplay } from '../safe-display.js';

const FETCHERS = {
  workbuddy: fetchWorkBuddyLimits,
  glm: fetchGlmLimits,
  minimax: fetchMiniMaxLimits,
  'alibaba-coding': fetchAlibabaCodingLimits,
  codex: fetchCodexLimits,
  'claude-code': fetchClaudeLimits,
  'kimi-code': fetchKimiLimits,
  kiro: fetchKiroLimits,
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
let cacheGeneration = 0;

// 仅 Cursor HTTP 403（常见于地域封锁）冷却；其他供应商保留各自的认证恢复流程。
// 手动刷新、账户/设置变更与 clearLimitCache 立即解除；状态只存在于本进程内存，不持久化、不进导出。
const FORBIDDEN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const forbiddenCooldowns = new Map();

function cooldownScope(providerId, accountId = '') {
  return accountId ? `${providerId}:${accountId}` : providerId;
}

function forbiddenCooldownError() {
  return Object.assign(new Error('供应商拒绝了额度请求，可能因账号或所在地区受限。'), { code: 'forbidden' });
}

function forbiddenCooldownActive(providerId, accountId, at) {
  const key = cooldownScope(providerId, accountId);
  const entry = forbiddenCooldowns.get(key);
  if (!entry) return false;
  if (at < entry.attemptedAt || at >= entry.retryAfter) {
    forbiddenCooldowns.delete(key);
    return false;
  }
  return true;
}

function recordForbiddenCooldown(providerId, accountId, ttlMs, at) {
  if (providerId !== 'cursor') return;
  forbiddenCooldowns.set(cooldownScope(providerId, accountId), {
    attemptedAt: at,
    retryAfter: at + Math.max(ttlMs || 0, FORBIDDEN_COOLDOWN_MS),
  });
}

function classifyProviderError(providerId, error) {
  // Cursor's verified 403 policy must not change other providers' auth flows.
  if (providerId === 'cursor' && error?.status === 403) {
    return Object.assign(new Error('Cursor quota access was denied.'), { code: 'forbidden', status: 403 });
  }
  return error;
}

function providerError(provider, error) {
  const knownCodes = new Set([
    'not_configured', 'unauthorized', 'forbidden', 'timeout', 'network_error', 'provider_error',
    'invalid_response', 'blocked_endpoint', 'workspace_unavailable',
  ]);
  return {
    id: provider.id,
    label: provider.label,
    status: 'error',
    ...([...REGIONAL_PLAN_IDS, 'workbuddy'].includes(provider.id) && /^[a-f0-9]{32}$/.test(error?.accountId || '')
      || provider.id === 'opencode' && /^local_[a-f0-9]{32}$/.test(error?.accountId || '')
      ? { accountId: error.accountId } : {}),
    error: {
      code: knownCodes.has(error?.code) ? error.code : 'provider_error',
      message: {
        not_configured: `${provider.label} 尚未配置，或未检测到可用登录。`,
        unauthorized: `${provider.label} 登录已失效，或无权读取额度。`,
        forbidden: `${provider.label} 额度访问被拒绝（可能因所在地区受限），已暂停自动重试；手动刷新可立即重试。`,
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
    ...(providerId === 'kimi-code' ? {
      authMode: account.authMode,
      connectionType: account.connectionType,
      environmentVariable: account.environmentVariable,
      credentialKey: account.legacyCredential ? 'kimi-code' : providerAccountCredentialKey(providerId, account.id),
    } : {}),
    accountId: account.id,
    accountLabel: account.label,
    ...(providerId === 'opencode' ? {
      connectionType: account.connectionType || 'workspace',
    } : {}),
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
    if (providerId === 'opencode' && providerSettings.authMode === 'local'
        && !providerSettings.accounts?.length && !providerSettings.workspaceId) {
      const value = readLocalGoKey(environment);
      return value.status === 'ok' ? detected('detected', '已检测到 OpenCode Go 本机登录')
        : detected('not_detected', '未检测到 OpenCode Go 本机登录', '请先登录 OpenCode，或添加手动账户');
    }
    if (providerId === 'codex') {
      const value = loadCodexCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Codex 登录')
        : value.found ? detected('expired', 'Codex 登录已过期', '运行 codex 重新登录')
          : detected('needs_login', '请先登录 Codex CLI', '运行 codex 并完成登录');
    }
    if (providerId === 'claude-code') {
      const value = loadClaudeCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Claude Code 登录')
        : value.found ? detected('expired', 'Claude 登录已过期', '运行 claude 重新登录')
          : detected('needs_login', '请先登录 Claude Code', '运行 claude 并完成登录');
    }
    if (providerId === 'cursor') {
      const value = loadCursorCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Cursor 桌面端登录')
        : value.found ? detected('expired', 'Cursor 登录已过期', '在 Cursor 桌面端重新登录')
          : detected('needs_login', '未检测到 Cursor 登录', '打开 Cursor 桌面端并登录');
    }
    if (providerId === 'kiro') {
      const value = loadKiroCredentials(environment);
      return value.found && value.fresh ? detected('detected', '已检测到 Kiro CLI 登录')
        : value.found ? detected('expired', 'Kiro CLI 登录已过期', '运行 kiro-cli login 重新登录')
          : detected('needs_login', '请先登录 Kiro CLI', '运行 kiro-cli login');
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

function kimiAccountDetections(settings, { environment, hasSecret, detectCredentials, kimiCredentialLoader = loadKimiCredentials }) {
  let localState;
  return Object.fromEntries(settings.accounts.map(account => {
    const source = account.connectionType === 'local' ? 'local' : account.authMode;
    let state = 'unchecked';
    if (detectCredentials === true) {
      if (source === 'local') {
        if (!localState) {
          try {
            const login = kimiCredentialLoader(environment);
            localState = !login.found ? 'absent' : login.fresh || login.refreshable ? 'present' : 'expired';
          } catch { localState = 'unchecked'; }
        }
        state = localState;
      } else if (source === 'environment') {
        state = environmentSecret(account.environmentVariable, environment) ? 'present' : 'absent';
      } else {
        state = hasSecret(account.legacyCredential ? 'kimi-code' : providerAccountCredentialKey('kimi-code', account.id)) ? 'present' : 'absent';
      }
    }
    // Bind status to the inspected connection, so editing a draft cannot reuse
    // readiness from another auth mode or environment variable. No secret values.
    return [account.id, { source, state, connectionType: account.connectionType,
      ...(source === 'environment' ? { environmentVariable: account.environmentVariable } : {}) }];
  }));
}

function providerDetection(provider, settings, { environment, hasKeychainSecret, hasSecret, run, platform, kimiDetections }) {
  if (provider.quotaSupport === 'unavailable') return detected('unavailable', '订阅额度暂不可查');
  if (provider.id === 'kimi-code') {
    const accounts = settings.accounts || [];
    if (accounts.length === 1 && accounts[0].connectionType === 'local') {
      const state = kimiDetections[accounts[0].id].state;
      return state === 'present' ? detected('detected', '已检测到 Kimi Code 登录')
        : state === 'expired' ? detected('expired', 'Kimi 登录已过期', '运行 kimi 重新登录，下次查询自动重读，无需重启')
          : state === 'unchecked' ? detected('unchecked', '本机登录尚未确认')
            : detected('needs_login', '请先登录 Kimi Code', '运行 kimi 并完成登录');
    }
    const ready = accounts.filter(account => kimiDetections[account.id].state === 'present').length;
    return detected(ready ? 'configured' : 'manual', `${ready}/${accounts.length} 个 Kimi 账户已配置`, '本机登录与 API Key 分开查询；不会切换 CLI 登录');
  }
  const local = detectLocalProvider(provider.id, settings, environment, { run, platform });
  if (local?.state === 'detected') return local;
  if (provider.id === 'opencode') {
    if (local) return local;
    if (settings.accounts?.length) {
      const ready = settings.accounts.filter((account) => (
        Boolean(account.label && (account.connectionType === 'api-key' || account.workspaceId))
        && hasSecret(providerAccountCredentialKey(provider.id, account.id))
      )).length;
      return ready === settings.accounts.length
        ? detected('configured', `${ready} 个 OpenCode Go 账户已配置`)
        : detected('manual', `${ready}/${settings.accounts.length} 个 OpenCode Go 账户已配置`, '每个账户需要名称，并完整配置 API Key 或 Cookie + Workspace ID');
    }
    return detected('manual', '需要连接 OpenCode Go 账户', '添加账户并选择 API Key 或 Cookie + Workspace ID');
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
  const probeSecret = options.hasSecret
    || ((credentialKey) => {
      const providerId = String(credentialKey || '').split(':', 1)[0];
      return keychainProviders.has(providerId) && Boolean(readSecret(credentialKey));
    });
  // Unknown is not absence: ordinary settings reads must not touch credentials.
  const checkedSecrets = new Map();
  const hasSecret = (key) => {
    if (options.detectCredentials !== true) return null;
    if (!checkedSecrets.has(key)) checkedSecrets.set(key, Boolean(probeSecret(key)));
    return checkedSecrets.get(key);
  };
  const secretStates = Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, hasSecret(regionalCredentialKey(provider.id, settings.providers[provider.id]))]));
  const kimiDetections = kimiAccountDetections(settings.providers['kimi-code'], { ...options, environment, hasSecret });
  const detections = options.detections || Object.fromEntries(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id,
    options.detectCredentials === true ? providerDetection(provider, settings.providers[provider.id], {
      environment, hasKeychainSecret: secretStates[provider.id], hasSecret,
      run: options.run, platform: options.platform, kimiDetections,
    }) : { state: 'unchecked', label: '尚未检测本机登录' },
  ]));
  return publicLimitSettings(settings, {
    keychainAvailable: options.keychainAvailable ?? keychainAvailable(),
    hasSecret, detections, kimiDetections,
  });
}

export function saveLimitSettings(payload, {
  config = loadConfig() || {},
  writeSecret = writeKeychainSecret,
  deleteSecret = deleteKeychainSecret,
  save = saveConfig,
} = {}) {
  const incoming = payload?.settings || payload;
  const kimiDraft = incoming?.providers?.['kimi-code']?.accounts;
  if (kimiDraft != null && (!Array.isArray(kimiDraft) || kimiDraft.length > 20
    || kimiDraft.filter(account => account?.connectionType === 'local').length > 1
    || new Set(kimiDraft.map(account => account?.id)).size !== kimiDraft.length)) {
    throw new Error('Kimi 最多支持 20 个连接、1 个本机登录，每个连接需要独立 ID。');
  }
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
  // Validate the whole Kimi draft before changing any stored credential.
  const kimi = settings.providers['kimi-code'];
  if (kimi.enabled && !kimi.accounts.length) throw new Error('Kimi Code 已启用，请添加至少一个账户。');
  for (const account of kimi.accounts) {
    if (!account.label) throw new Error('请填写每个 Kimi 账户的名称。');
    if (account.connectionType === 'local') continue;
    if (account.authMode === 'environment') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(account.environmentVariable)) throw new Error('请填写有效的 Kimi 账户环境变量名。');
      continue;
    }
    const prior = current.providers['kimi-code'].accounts.find(item => item.id === account.id);
    const secret = accountSecrets['kimi-code']?.[account.id];
    const unchanged = prior?.connectionType === account.connectionType && prior.authMode === account.authMode
      && prior.legacyCredential === account.legacyCredential;
    if (!(typeof secret === 'string' && secret.trim()) && !unchanged) throw new Error('新增或更换 Kimi 连接方式时，请重新填写该账户的凭据。');
    if (secret && (secret.length > 32_768 || /[\s\x00-\x1f]/.test(secret.trim()))) throw new Error('Kimi 凭据格式无效，请只粘贴 API Key 或登录令牌。');
  }
  // Build and validate the entire change set before touching Keychain. A late
  // invalid provider must not replace/remove an earlier provider's credentials.
  const credentialChanges = [];
  for (const provider of LIMIT_PROVIDER_CATALOG) {
    const credentialKey = regionalCredentialKey(provider.id, settings.providers[provider.id]);
    if (clearSecrets.has(provider.id)) credentialChanges.push({ key: credentialKey, remove: true });
    if (typeof secrets[provider.id] === 'string' && secrets[provider.id].trim()) {
      if (!provider.authModes.includes('keychain')) throw new Error(`${provider.label} 不支持手动钥匙串凭据。`);
      if (provider.id === 'workbuddy') parseWorkBuddyCredential(secrets[provider.id]);
      credentialChanges.push({ key: credentialKey, value: secrets[provider.id] });
    }
    const priorAccounts = new Set(current.providers[provider.id]?.accounts?.map((account) => account.id) || []);
    const nextAccounts = new Set(settings.providers[provider.id]?.accounts?.map((account) => account.id) || []);
    for (const accountId of priorAccounts) {
      const prior = current.providers[provider.id].accounts.find(account => account.id === accountId);
      if (!nextAccounts.has(accountId)) credentialChanges.push({ key: provider.id === 'kimi-code' && prior.legacyCredential ? provider.id : providerAccountCredentialKey(provider.id, accountId), remove: true });
    }
    for (const account of settings.providers[provider.id]?.accounts || []) {
      const key = provider.id === 'kimi-code' && account.legacyCredential ? provider.id : providerAccountCredentialKey(provider.id, account.id);
      if (provider.id === 'kimi-code') {
        const prior = current.providers[provider.id].accounts.find(item => item.id === account.id);
        if (prior && (prior.connectionType !== account.connectionType || prior.legacyCredential !== account.legacyCredential)) {
          credentialChanges.push({ key: prior.legacyCredential ? provider.id : providerAccountCredentialKey(provider.id, account.id), remove: true });
        }
      }
      if (clearAccountSecrets.has(key)) credentialChanges.push({ key, remove: true });
      const secret = accountSecrets?.[provider.id]?.[account.id];
      if (typeof secret === 'string' && secret.trim()) credentialChanges.push({ key, value: secret });
    }
  }
  for (const change of credentialChanges) {
    if (change.remove) deleteSecret(change.key);
    else writeSecret(change.key, change.value);
  }
  save({ ...config, subscriptionLimits: settings,
    ...(kimi.enabled && !config.sessionSalt && !config.quotaIdentitySalt ? { quotaIdentitySalt: createSessionSalt() } : {}) });
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
  cacheGeneration += 1;
  inFlight = null;
  cachedResult = null;
  cacheKey = '';
  cacheExpiresAt = 0;
  forbiddenCooldowns.clear();
}

async function fetchEnabled(settings, options = {}) {
  const catalogById = new Map(LIMIT_PROVIDER_CATALOG.map((provider) => [provider.id, provider]));
  const enabled = settings.providerOrder
    .map((id) => catalogById.get(id))
    .filter((provider) => provider && settings.providers[provider.id]?.enabled);
  const at = (options.now || Date.now)();
  const cooldownTtlMs = settings.refreshMinutes * 60_000;
  const providers = await Promise.all(enabled.map(async (provider) => {
    const fetchProvider = options.fetchers?.[provider.id] || FETCHERS[provider.id];
    try {
      if (!fetchProvider) throw Object.assign(new Error(`${provider.label} 暂不支持订阅额度查询。`), { code: 'not_configured' });
      const configuredAccounts = settings.providers[provider.id]?.accounts || [];
      if (provider.id === 'kimi-code' && !configuredAccounts.length) throw Object.assign(new Error('No Kimi accounts'), { code: 'not_configured' });
      if (provider.accountMode && configuredAccounts.length) {
        const accounts = await Promise.all(configuredAccounts.map(async (account) => {
          try {
            if (provider.id === 'opencode' && (
              !account.label || (account.connectionType !== 'api-key' && !account.workspaceId)
            )) {
              const error = new Error('OpenCode Go 账户需要名称，并完整配置 API Key 或 Cookie + Workspace ID。');
              error.code = 'not_configured';
              throw error;
            }
            if (forbiddenCooldownActive(provider.id, account.id, at)) {
              return accountResult(provider, account, providerError(provider, forbiddenCooldownError()));
            }
            forbiddenCooldowns.delete(cooldownScope(provider.id, account.id));
            const result = await fetchProvider({
              settings: accountSettings(provider.id, settings.providers[provider.id], account),
              environment: options.environment || process.env,
              fetcher: options.fetcher || fetch,
              run: options.run, platform: options.platform, localRequester: options.localRequester,
              identitySalt: options.identitySalt,
            });
            return accountResult(provider, account, assertProviderContract(provider.id, result));
          } catch (error) {
            error = classifyProviderError(provider.id, error);
            if (error?.code === 'forbidden' && options.isCurrentRequest?.() !== false) recordForbiddenCooldown(provider.id, account.id, cooldownTtlMs, at);
            return accountResult(provider, account, providerError(provider, error));
          }
        }));
        if (provider.id === 'kimi-code') {
          const owners = new Map();
          for (const account of accounts) {
            // Matching opaque scope proves either the same returned owner or
            // the exact same credential; distinct unverified keys stay apart.
            if (!account.historyAccountId) continue;
            if (owners.has(account.historyAccountId)) account.duplicateOf = owners.get(account.historyAccountId);
            else owners.set(account.historyAccountId, account.accountId);
          }
        }
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
      if (forbiddenCooldownActive(provider.id, '', at)) {
        return providerError(provider, forbiddenCooldownError());
      }
      forbiddenCooldowns.delete(cooldownScope(provider.id));
      const result = await fetchProvider({
        settings: settings.providers[provider.id],
        environment: options.environment || process.env,
        fetcher: options.fetcher || fetch,
        run: options.run, platform: options.platform, localRequester: options.localRequester,
        identitySalt: options.identitySalt,
      });
      return {
        ...assertProviderContract(provider.id, result),
        ...([...REGIONAL_PLAN_IDS, 'workbuddy'].includes(provider.id) && /^[a-f0-9]{32}$/.test(result.accountId || '')
          || provider.id === 'opencode' && /^local_[a-f0-9]{32}$/.test(result.accountId || '')
          ? { accountId: result.accountId } : {}),
        label: provider.label,
        quotaCoverage: provider.quotaCoverage || 'supported',
      };
    } catch (error) {
      error = classifyProviderError(provider.id, error);
      if (error?.code === 'forbidden' && options.isCurrentRequest?.() !== false) recordForbiddenCooldown(provider.id, '', cooldownTtlMs, at);
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
    clearLimitCache();
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
  const clock = options.now || Date.now;
  // 手动刷新立即解除 403 冷却（设置保存与 clearLimitCache 走同一条解除路径）。
  if (force) forbiddenCooldowns.clear();
  const nextKey = JSON.stringify(settings);
  if (!force && cachedResult && cacheKey === nextKey && clock() < cacheExpiresAt) return cachedResult;
  if (!force && inFlight?.key === nextKey && inFlight.generation === cacheGeneration) return inFlight.promise;
  const request = { key: nextKey, generation: cacheGeneration };
  // A forced refresh supersedes an older query even without settings changes.
  inFlight = request;
  request.promise = fetchEnabled(settings, { ...options,
    isCurrentRequest: () => request.generation === cacheGeneration && inFlight === request,
    identitySalt: config?.quotaIdentitySalt || config?.sessionSalt || options.identitySalt })
    .then((result) => {
      if (request.generation !== cacheGeneration || inFlight !== request) return { ...result, history: history() };
      try { historyRecorder(result); } catch { /* Quota display must survive history I/O failures. */ }
      cachedResult = { ...result, history: history() };
      cacheKey = nextKey;
      cacheExpiresAt = clock() + settings.refreshMinutes * 60_000;
      return cachedResult;
    })
    .finally(() => { if (inFlight === request) inFlight = null; });
  return request.promise;
}
