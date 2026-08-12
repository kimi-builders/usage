import { operatingSystemInfo } from '../../device-info.js';
import { resolveProviderSecret } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const WARP_URL = 'https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo';
const QUERY = `query GetRequestLimitInfo($requestContext: RequestContext!) {
  user(requestContext: $requestContext) {
    __typename
    ... on UserOutput {
      user {
        requestLimitInfo { isUnlimited nextRefreshTime requestLimit requestsUsedSinceLastRefresh }
        bonusGrants { requestCreditsGranted requestCreditsRemaining expiration }
        workspaces { bonusGrantsInfo { grants { requestCreditsGranted requestCreditsRemaining expiration } } }
      }
    }
  }
}`;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWarpUsage(payload, { now = new Date() } = {}) {
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(payload.errors.map((error) => error?.message).filter(Boolean).join(' · ') || 'Warp GraphQL 查询失败。');
  }
  const user = payload?.data?.user?.user;
  const info = user?.requestLimitInfo;
  if (!info) throw new Error('Warp 返回数据中没有 requestLimitInfo。');
  const limit = number(info.requestLimit);
  const used = number(info.requestsUsedSinceLastRefresh);
  const unlimited = info.isUnlimited === true;
  const grants = [
    ...(Array.isArray(user.bonusGrants) ? user.bonusGrants : []),
    ...(Array.isArray(user.workspaces) ? user.workspaces.flatMap((workspace) => workspace?.bonusGrantsInfo?.grants || []) : []),
  ];
  const bonusLimit = grants.reduce((sum, grant) => sum + number(grant.requestCreditsGranted), 0);
  const bonusRemaining = grants.reduce((sum, grant) => sum + number(grant.requestCreditsRemaining), 0);
  const windows = [{
    id: 'credits', label: '月度 Credits',
    usedPercent: unlimited ? 0 : limit > 0 ? asPercent(used / limit * 100) : 0,
    remainingPercent: unlimited ? 100 : limit > 0 ? asPercent((limit - used) / limit * 100) : 100,
    resetsAt: unlimited ? null : asDate(info.nextRefreshTime), value: used, limit,
    unit: 'credits', detail: unlimited ? 'Unlimited' : `${used}/${limit} credits`,
  }];
  if (bonusLimit > 0 || bonusRemaining > 0) {
    windows.push({
      id: 'bonus', label: '附加 Credits',
      usedPercent: bonusLimit > 0 ? asPercent((bonusLimit - bonusRemaining) / bonusLimit * 100) : 0,
      remainingPercent: bonusLimit > 0 ? asPercent(bonusRemaining / bonusLimit * 100) : 100,
      resetsAt: grants.map((grant) => asDate(grant.expiration)).filter(Boolean).sort()[0] || null,
      value: Math.max(0, bonusLimit - bonusRemaining), limit: bonusLimit, unit: 'credits',
    });
  }
  return {
    id: 'warp', label: 'Warp', status: 'ok', account: null, plan: unlimited ? 'Unlimited' : null,
    source: 'Warp API Key', updatedAt: now.toISOString(), windows,
    notice: 'Warp 以 Credits 计量；主额度与附加额度分开显示。',
  };
}

export async function fetchWarpLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const apiKey = resolveProviderSecret('warp', settings, environment);
  if (!apiKey) {
    const error = new Error('未找到 Warp API Key。请在额度设置中配置环境变量或 macOS 钥匙串。');
    error.code = 'not_configured';
    throw error;
  }
  const os = operatingSystemInfo();
  const osName = os.name || process.platform;
  const payload = await requestJson(WARP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Warp/1.0',
      'x-warp-client-id': 'warp-app',
      'x-warp-os-category': osName,
      'x-warp-os-name': osName,
      'x-warp-os-version': os.version || '',
    },
    body: {
      query: QUERY,
      operationName: 'GetRequestLimitInfo',
      variables: { requestContext: { clientContext: {}, osContext: { category: osName, name: osName, version: os.version || '' } } },
    },
    fetcher,
  });
  return parseWarpUsage(payload);
}
