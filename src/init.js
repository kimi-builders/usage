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

export function deviceAuthorizationGuide(authorization) {
  const minutes = Math.max(1, Math.ceil(Number(authorization?.expiresIn || 600) / 60));
  return [
    '[1/3] 正在连接 Kimi Builders 社区账户。此步骤只创建设备授权，不扫描、也不上传用量。',
    `[2/3] 请在 ${minutes} 分钟内打开授权页并核对验证码：`,
    `      ${authorization.verificationUriComplete}`,
    `      验证码：${authorization.userCode}`,
    '      等待浏览器批准…（可按 Ctrl+C 取消）',
  ];
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
    for (const line of deviceAuthorizationGuide(authorization)) console.log(line);
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
    connectedAt: new Date().toISOString(),
    sessionSalt,
    ...(!existing ? { onboardingPending: true } : {}),
  };
  saveConfig(existing ? connectedConfig : applySourcePolicies(
    connectedConfig,
    newInstallSourcePolicies({ sync: syncAfterConnect }),
  ));
  console.log(`[3/3] 设备已连接，配置保存到 owner-only 文件。Key 前缀：${apiKey.slice(0, 12)}…`);
  if (syncAfterConnect) {
    console.log('你明确使用了 --sync；现在开始扫描并上传已允许的数据源。');
    const { runSync } = await import('./sync.js');
    await runSync();
  } else {
    console.log('连接完成 ≠ 数据已同步：目前尚未上传任何用量。');
    console.log('请打开本地看板，逐个选择 Agent 的本机扫描与社区同步范围：');
    console.log('  npx @kimi.builders/usage dashboard');
    console.log('如需沿用旧版“一连接就同步全部自动来源”的行为，可运行 init --sync。');
  }
}
