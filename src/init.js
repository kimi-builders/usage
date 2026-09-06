import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { createSessionSalt, loadConfig, saveConfig } from './config.js';
import { fetchSettings, pollDeviceToken, requestDeviceCode } from './api.js';
import { normalizeCommunityUrl } from './community-url.js';
import { getLocale } from './cli-ui.js';
import { deviceDisplayName } from './device-info.js';
import { applySourcePolicies, newInstallSourcePolicies } from './source-policy.js';

export function browserCommand(url, currentPlatform = platform()) {
  if (currentPlatform === 'darwin') return ['open', [url]];
  if (currentPlatform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

export function deviceAuthorizationGuide(authorization) {
  const minutes = Math.max(1, Math.ceil(Number(authorization?.expiresIn || 600) / 60));
  if (getLocale() !== 'zh') {
    return [
      '[1/3] Connecting a Kimi Builders community account. This creates device authorization only; it does not scan or upload usage.',
      `[2/3] Open the authorization page within ${minutes} minutes and confirm this code:`,
      `      ${authorization.verificationUriComplete}`,
      `      Code: ${authorization.userCode}`,
      '      Waiting for browser approval… (press Ctrl+C to cancel)',
    ];
  }
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

export async function runInit({
  apiUrl = 'https://kimi.builders', manualKey, syncAfterConnect = false, updatePricing = true,
} = {}) {
  const isZh = getLocale() === 'zh';
  const normalizedApiUrl = normalizeCommunityUrl(apiUrl);
  const existing = loadConfig();
  const sessionSalt = existing?.sessionSalt || createSessionSalt();
  let apiKey = manualKey;
  let deviceId = existing?.deviceId;
  if (apiKey && !/^kbu_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
    throw new Error(isZh ? 'API Key 必须是 kbu_ 开头的设备 Key。' : 'API Key must be a device key beginning with kbu_.');
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
      else if (result.error === 'access_denied') throw new Error(isZh ? '设备连接已被拒绝。' : 'Device connection was denied.');
      else if (result.error === 'expired_token') throw new Error(isZh ? '验证码已过期。' : 'The authorization code expired.');
      else throw new Error(isZh ? `设备连接失败：${result.error || 'unknown_error'}` : `Device connection failed: ${result.error || 'unknown_error'}`);
    }
    if (!apiKey) throw new Error(isZh ? '验证码已过期。' : 'The authorization code expired.');
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
  console.log(isZh
    ? `[3/3] 设备已连接，配置保存到 owner-only 文件。Key 前缀：${apiKey.slice(0, 12)}…`
    : `[3/3] Device connected. Configuration was saved to an owner-only file. Key prefix: ${apiKey.slice(0, 12)}…`);
  if (updatePricing) {
    try {
      const { updatePriceCatalog } = await import('./pricing/catalog.js');
      const pricing = await updatePriceCatalog({ apiUrl: normalizedApiUrl });
      console.log(pricing.changed
        ? (isZh ? `标准 API 价格目录已更新至 ${pricing.version}。` : `Standard API pricing updated to ${pricing.version}.`)
        : (isZh ? `标准 API 价格目录已就绪：${pricing.version}。` : `Standard API pricing is ready: ${pricing.version}.`));
    } catch (error) {
      console.warn(isZh
        ? `⚠ 价格目录暂时无法更新，将继续使用随包内置或上次可用版本：${error?.message || error}`
        : `⚠ Pricing could not be updated. Continuing with the bundled or last-known-good catalog: ${error?.message || error}`);
    }
  } else {
    console.log(isZh
      ? '已跳过价格目录更新；本地估费继续使用随包内置或上次可用版本。'
      : 'Pricing update skipped; local estimates continue using the bundled or last-known-good catalog.');
  }
  if (syncAfterConnect) {
    console.log(isZh
      ? '你明确使用了 --sync；现在开始扫描并上传已允许的数据源。'
      : 'You explicitly used --sync; scanning and uploading permitted sources now.');
    const { runSync } = await import('./sync.js');
    await runSync();
  } else {
    console.log(isZh ? '连接完成 ≠ 数据已同步：目前尚未上传任何用量。' : 'Connected does not mean synchronized: no usage has been uploaded yet.');
    console.log(isZh
      ? '请打开本地看板，逐个选择 Agent 的本机扫描与社区同步范围：'
      : 'Open the local dashboard and choose local scanning and community sync scope for each Agent:');
    console.log('  npx @kimi.builders/usage dashboard');
    console.log(isZh
      ? '如需沿用旧版“一连接就同步全部自动来源”的行为，可运行 init --sync。'
      : 'To retain the legacy “sync all automatic sources on connect” behavior, run init --sync.');
  }
}
