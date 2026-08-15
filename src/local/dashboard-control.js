import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import {
  deleteCurrentDeviceData, fetchSettings, pollDeviceToken, requestDeviceCode, revokeCurrentDevice,
} from '../api.js';
import { COLLECTOR_VERSION } from '../client-meta.js';
import { createSessionSalt, loadConfig, saveConfig } from '../config.js';
import { normalizeCommunityUrl } from '../community-url.js';
import { deviceDisplayName, deviceEnvironment } from '../device-info.js';
import { getDaemonStatus, uninstallDaemon } from '../daemon.js';
import { sourceRegistry } from '../parsers/index.js';
import {
  applySourcePolicies, effectiveSourcePolicies, sourcePolicyIsExplicit,
} from '../source-policy.js';
import { clearState } from '../state.js';

function connected(config) {
  return Boolean(config?.apiKey && config?.sessionSalt);
}

function publicAuthorization(pending, currentTime) {
  if (!pending) return null;
  const expired = pending.expiresAt <= currentTime;
  return {
    status: expired ? 'expired' : pending.status,
    userCode: pending.userCode,
    verificationUri: pending.verificationUri,
    verificationUriComplete: pending.verificationUriComplete,
    expiresAt: new Date(pending.expiresAt).toISOString(),
    expiresIn: Math.max(0, Math.ceil((pending.expiresAt - currentTime) / 1_000)),
    interval: pending.interval,
  };
}

export async function detectSourceCatalog({ config = loadConfig(), registry = sourceRegistry } = {}) {
  const policies = effectiveSourcePolicies(config, registry);
  return Promise.all(registry.map(async (source) => {
    let rootCount = 0;
    let detection = 'ok';
    try {
      rootCount = ((await source.roots({ sourceOptions: config?.sourceOptions || {} })) || []).length;
    } catch {
      detection = 'error';
    }
    const cursorPath = source.id === 'cursor' ? config?.sourceOptions?.cursor?.csvPath : '';
    let cursorConfigured = false;
    if (cursorPath) {
      try { cursorConfigured = existsSync(cursorPath) && statSync(cursorPath).isFile(); }
      catch { cursorConfigured = false; }
    }
    return {
      id: source.id,
      tier: source.tier,
      mode: policies[source.id],
      detected: rootCount > 0,
      rootCount,
      detection,
      configurable: source.id === 'cursor',
      ...(source.id === 'cursor' ? {
        configuration: {
          kind: 'file',
          configured: cursorConfigured,
        },
      } : {}),
    };
  }));
}

export async function getDashboardControlState({
  config = loadConfig(), registry = sourceRegistry, daemon = getDaemonStatus(), authorization = null,
} = {}) {
  const apiUrl = config?.apiUrl || 'https://kimi.builders';
  const isConnected = connected(config);
  const failureAt = Date.parse(daemon?.lastSync?.lastAttemptAt || '');
  const connectedAt = Date.parse(config?.connectedAt || '');
  const authenticationFailed = isConnected
    && daemon?.lastSync?.lastErrorCode === 'authentication_failed'
    && (!Number.isFinite(connectedAt) || !Number.isFinite(failureAt) || failureAt >= connectedAt);
  const environment = isConnected ? deviceEnvironment() : null;
  return {
    onboardingRequired: !config || config.onboardingPending === true,
    policyExplicit: sourcePolicyIsExplicit(config),
    community: {
      connected: isConnected,
      status: authenticationFailed ? 'attention' : isConnected ? 'connected' : authorization?.status || 'disconnected',
      apiUrl,
      dashboardUrl: new URL('/usage', normalizeCommunityUrl(apiUrl)).toString(),
      authorization,
      device: isConnected ? {
        id: config.deviceId || '',
        name: deviceDisplayName(),
        collectorVersion: COLLECTOR_VERSION,
        terminal: environment.terminal,
        os: environment.os,
      } : null,
    },
    daemon,
    sources: await detectSourceCatalog({ config, registry }),
  };
}

function invalidAction(message = 'Unsupported dashboard control action.') {
  return Object.assign(new Error(message), { statusCode: 400, code: 'invalid_control_action' });
}

function applyPoliciesSafely(config, policies, registry) {
  try {
    return applySourcePolicies(config, policies, registry);
  } catch (error) {
    throw Object.assign(new Error(error.message), { statusCode: 400, code: 'invalid_control_input' });
  }
}

export function createDashboardControl({
  configLoader = loadConfig,
  configSaver = saveConfig,
  registry = sourceRegistry,
  deviceCodeRequester = requestDeviceCode,
  deviceTokenPoller = pollDeviceToken,
  settingsFetcher = fetchSettings,
  remoteDataDeleter = deleteCurrentDeviceData,
  remoteDeviceRevoker = revokeCurrentDevice,
  daemonStatus = getDaemonStatus,
  daemonUninstaller = uninstallDaemon,
  stateClearer = clearState,
  now = () => Date.now(),
} = {}) {
  let pendingConnection = null;

  const state = async () => {
    let config = configLoader();
    if (config && !sourcePolicyIsExplicit(config)) {
      config = applySourcePolicies(config, effectiveSourcePolicies(config, registry), registry);
      configSaver(config);
    }
    return getDashboardControlState({
      config,
      registry,
      daemon: daemonStatus(),
      authorization: publicAuthorization(pendingConnection, now()),
    });
  };

  const act = async (payload = {}) => {
    const action = String(payload.action || '');
    const loadedConfig = configLoader();
    const config = loadedConfig || {};
    if (['save-sources', 'prepare-onboarding', 'complete-onboarding'].includes(action)) {
      const next = applyPoliciesSafely({
        ...config,
        sessionSalt: config.sessionSalt || createSessionSalt(),
        ...(action === 'prepare-onboarding' ? { onboardingPending: true } : {}),
        ...(action === 'complete-onboarding' ? {
          onboardingPending: false,
          onboardingCompletedAt: new Date(now()).toISOString(),
        } : {}),
      }, payload.sourcePolicies, registry);
      configSaver(next);
      return { ...(await state()), action };
    }
    if (action === 'configure-source') {
      if (payload.sourceId !== 'cursor') throw invalidAction('This source has no Dashboard configuration.');
      const csvPath = String(payload.csvPath || '').trim();
      if (!csvPath) {
        throw Object.assign(new Error('Choose the Cursor usage CSV file first.'), {
          statusCode: 400, code: 'invalid_control_input',
        });
      }
      const absolutePath = resolve(csvPath);
      if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        throw Object.assign(new Error('Cursor CSV does not exist or is not a regular file.'), {
          statusCode: 400, code: 'invalid_control_input',
        });
      }
      configSaver({
        ...config,
        sessionSalt: config.sessionSalt || createSessionSalt(),
        ...(!loadedConfig ? { onboardingPending: true } : {}),
        sourceOptions: {
          ...(config.sourceOptions || {}),
          cursor: { ...(config.sourceOptions?.cursor || {}), csvPath: absolutePath },
        },
      });
      return { ...(await state()), action };
    }
    if (action === 'connect-start') {
      const currentTime = now();
      if (pendingConnection && pendingConnection.status === 'pending' && pendingConnection.expiresAt > currentTime) {
        return { action, ...publicAuthorization(pendingConnection, currentTime) };
      }
      const apiUrl = normalizeCommunityUrl(payload.apiUrl || config.apiUrl || 'https://kimi.builders');
      const authorization = await deviceCodeRequester(apiUrl, {
        clientName: '@kimi.builders/usage',
        deviceName: deviceDisplayName(),
        platform: platform(),
        surface: 'local-dashboard',
      });
      pendingConnection = {
        apiUrl,
        deviceCode: authorization.deviceCode,
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri,
        verificationUriComplete: authorization.verificationUriComplete,
        expiresAt: currentTime + Number(authorization.expiresIn || 600) * 1000,
        interval: authorization.interval || 5,
        status: 'pending',
      };
      return { action, ...publicAuthorization(pendingConnection, currentTime) };
    }
    if (action === 'connect-poll') {
      if (!pendingConnection || pendingConnection.expiresAt <= now()) {
        if (pendingConnection) {
          pendingConnection.status = 'expired';
          pendingConnection.deviceCode = '';
        }
        return { ...(await state()), action, status: 'expired' };
      }
      const result = await deviceTokenPoller(pendingConnection.apiUrl, pendingConnection.deviceCode);
      if (!result?.apiKey) {
        if (result?.interval) pendingConnection.interval = result.interval;
        if (result?.error === 'access_denied') {
          pendingConnection.status = 'access_denied';
          pendingConnection.deviceCode = '';
        }
        return {
          ...(await state()),
          action,
          status: result?.error || 'authorization_pending',
          interval: pendingConnection.interval,
        };
      }
      await settingsFetcher(pendingConnection.apiUrl, result.apiKey);
      configSaver({
        ...config,
        apiUrl: pendingConnection.apiUrl,
        apiKey: result.apiKey,
        deviceId: result.deviceId,
        connectedAt: new Date(now()).toISOString(),
        sessionSalt: config.sessionSalt || createSessionSalt(),
      });
      pendingConnection = null;
      return { ...(await state()), action, status: 'connected' };
    }
    if (action === 'connect-cancel') {
      pendingConnection = null;
      return { ...(await state()), action, status: 'cancelled' };
    }
    if (action === 'disconnect') {
      if (!connected(config)) {
        throw Object.assign(new Error('This device is not connected.'), { statusCode: 409, code: 'not_connected' });
      }
      try {
        await remoteDeviceRevoker(config.apiUrl, config.apiKey);
      } catch (error) {
        throw Object.assign(new Error('The community device key could not be revoked.'), {
          statusCode: 502,
          code: 'remote_revoke_failed',
          cause: error,
        });
      }
      if (daemonStatus().installed) daemonUninstaller();
      const {
        apiKey: _apiKey, deviceId: _deviceId, connectedAt: _connectedAt, ...remaining
      } = config;
      configSaver(remaining);
      pendingConnection = null;
      return { ...(await state()), action };
    }
    if (action === 'disconnect-local') {
      if (daemonStatus().installed) daemonUninstaller();
      const {
        apiKey: _apiKey, deviceId: _deviceId, connectedAt: _connectedAt, ...remaining
      } = config;
      configSaver(remaining);
      pendingConnection = null;
      return { ...(await state()), action };
    }
    if (action === 'delete-device-data') {
      if (!connected(config)) {
        throw Object.assign(new Error('This device is not connected.'), { statusCode: 409, code: 'not_connected' });
      }
      const result = await remoteDataDeleter(config.apiUrl, config.apiKey);
      stateClearer();
      return { ...(await state()), action, result };
    }
    throw invalidAction();
  };
  return { state, act };
}
