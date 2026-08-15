import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { createSessionSalt, loadConfig, saveConfig } from './config.js';
import { fetchSettings, pollDeviceToken, requestDeviceCode } from './api.js';
import { normalizeCommunityUrl } from './community-url.js';
import { deviceDisplayName } from './device-info.js';
import { applySourcePolicies, newInstallSourcePolicies } from './source-policy.js';

export function browserCommand(url, currentPlatform = platform()) {
  if (currentPlatform === 'darwin') return ['open', [url]];
  if (currentPlatform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

function openBrowser(url) {
  const [command, args] = browserCommand(url);
  execFile(command, args, () => {});
}

export async function runInit({ apiUrl = 'https://kimi.builders', manualKey, syncAfterConnect = false } = {}) {
  const normalizedApiUrl = normalizeCommunityUrl(apiUrl);
  const existing = loadConfig();
  const sessionSalt = existing?.sessionSalt || createSessionSalt();
  let apiKey = manualKey;
  let deviceId = existing?.deviceId;
  if (apiKey && !/^kbu_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
    throw new Error('API Key 必须是 kbu_ 开头的设备 Key。');
  }
  if (!apiKey) {
    const authorization = await requestDeviceCode(normalizedApiUrl, {
      clientName: '@kimi.builders/usage',
      deviceName: deviceDisplayName(),
      platform: platform(),
      surface: 'cli',
    });
    console.log(`在浏览器批准设备：${authorization.verificationUriComplete}`);
    console.log(`验证码：${authorization.userCode}`);
    openBrowser(authorization.verificationUriComplete);
    const deadline = Date.now() + authorization.expiresIn * 1000;
    let interval = authorization.interval || 5;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      const result = await pollDeviceToken(normalizedApiUrl, authorization.deviceCode);
      if (result.apiKey) {
        apiKey = result.apiKey;
        deviceId = result.deviceId;
        break;
      }
      if (result.error === 'slow_down') interval = Math.max(interval, result.interval || interval);
      else if (result.error === 'authorization_pending') continue;
      else if (result.error === 'access_denied') throw new Error('设备连接已被拒绝。');
      else if (result.error === 'expired_token') throw new Error('验证码已过期。');
      else throw new Error(`设备连接失败：${result.error || 'unknown_error'}`);
    }
    if (!apiKey) throw new Error('验证码已过期。');
  }
  await fetchSettings(normalizedApiUrl, apiKey);
  const connectedConfig = {
    ...existing,
    apiUrl: normalizedApiUrl,
    apiKey,
    deviceId,
    sessionSalt,
    ...(!existing ? { onboardingPending: true } : {}),
  };
  saveConfig(existing ? connectedConfig : applySourcePolicies(
    connectedConfig,
    newInstallSourcePolicies({ sync: syncAfterConnect }),
  ));
  console.log(`设备已连接，配置保存到 owner-only 文件。Key 前缀：${apiKey.slice(0, 12)}…`);
  if (syncAfterConnect) {
    const { runSync } = await import('./sync.js');
    await runSync();
  } else {
    console.log('尚未上传任何用量。请打开本地看板选择每个 Agent 的扫描与同步范围：');
    console.log('  npx @kimi.builders/usage dashboard');
    console.log('如需沿用旧版“一连接就同步全部自动来源”的行为，可运行 init --sync。');
  }
}
