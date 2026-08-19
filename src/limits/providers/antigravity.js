import {
  loadAntigravityCredentials, parseOAuthCredentials, resolveProviderSecret,
} from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';
import { fetchAntigravityLocalQuota } from './antigravity-local.js';

const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
const MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels';
const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function family(modelId, label = '') {
  const value = `${modelId} ${label}`.toLowerCase();
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('claude') || value.includes('gpt')) return 'claude-gpt';
  return 'other';
}

function labelForFamily(value) {
  if (value === 'gemini') return 'Gemini 模型';
  if (value === 'claude-gpt') return 'Claude / GPT 模型';
  return '其他模型';
}

function quotaRows(payload) {
  if (Array.isArray(payload?.buckets)) return payload.buckets;
  const userStatus = payload?.userStatus || payload?.response?.userStatus || payload?.response;
  const configs = userStatus?.cascadeModelConfigData?.clientModelConfigs
    || payload?.clientModelConfigs || payload?.response?.clientModelConfigs;
  if (Array.isArray(configs)) return configs.map((model) => ({
    modelId: model?.modelId || model?.modelOrAlias,
    label: model?.label || model?.modelId || model?.modelOrAlias,
    remainingFraction: model?.quotaInfo?.remainingFraction,
    resetTime: model?.quotaInfo?.resetTime,
  }));
  const models = payload?.models && typeof payload.models === 'object' ? payload.models : {};
  return Object.entries(models).map(([modelId, model]) => ({
    modelId,
    label: model?.displayName || model?.label || modelId,
    remainingFraction: model?.quotaInfo?.remainingFraction,
    resetTime: model?.quotaInfo?.resetTime,
  }));
}

function summaryWindows(payload) {
  const groups = payload?.response?.groups || payload?.groups;
  if (!Array.isArray(groups)) return [];
  const familyRank = ['gemini', 'claude-gpt', 'other'];
  const windowRank = ['5h', 'weekly'];
  return groups.flatMap((group) => {
    const groupFamily = family('', group?.displayName || group?.description || '');
    return Array.isArray(group?.buckets) ? group.buckets.map((bucket) => {
      const remaining = Number(bucket?.remainingFraction ?? bucket?.remaining?.remainingFraction);
      if (!Number.isFinite(remaining)) return null;
      const id = text(bucket?.bucketId) || `${groupFamily}-${text(bucket?.window) || 'quota'}`;
      const window = text(bucket?.window) || (/5\s*hour|5h/i.test(`${id} ${bucket?.displayName || ''}`) ? '5h'
        : /week/i.test(`${id} ${bucket?.displayName || ''}`) ? 'weekly' : 'quota');
      const windowLabel = window === '5h' ? '5 小时' : window === 'weekly' ? '每周' : '额度';
      const percent = asPercent(Math.max(0, Math.min(1, remaining)) * 100);
      return {
        id,
        label: `${labelForFamily(groupFamily)} · ${windowLabel}`,
        remainingPercent: percent,
        usedPercent: 100 - percent,
        resetsAt: asDate(bucket?.resetTime ?? bucket?.remaining?.resetTime),
        windowSeconds: window === '5h' ? 18_000 : window === 'weekly' ? 604_800 : null,
        detail: `Antigravity 返回的 ${windowLabel}额度池`,
        _family: groupFamily,
        _window: window,
      };
    }).filter(Boolean) : [];
  }).sort((a, b) => familyRank.indexOf(a._family) - familyRank.indexOf(b._family)
    || windowRank.indexOf(a._window) - windowRank.indexOf(b._window))
    .map(({ _family, _window, ...window }) => window);
}

function summaryCandidate(row) {
  const value = `${row?.modelId || ''} ${row?.label || ''}`.toLowerCase();
  return !/(?:image|imagen|autocomplete|lite)/.test(value);
}

export function parseAntigravityQuota(payload, identity = {}, { now = new Date() } = {}) {
  const exactWindows = summaryWindows(payload);
  const parsedRows = quotaRows(payload).filter((row) => text(row?.modelId)
    && Number.isFinite(Number(row?.remainingFraction)));
  const rows = parsedRows.filter(summaryCandidate);
  const constrained = new Map();
  for (const row of rows) {
    const id = text(row.modelId);
    const group = family(id, row.label);
    const fraction = Math.max(0, Math.min(1, Number(row.remainingFraction)));
    const current = constrained.get(group);
    if (!current || fraction < current.fraction) constrained.set(group, {
      fraction,
      resetsAt: asDate(row.resetTime),
      modelId: id,
    });
  }
  const rank = ['gemini', 'claude-gpt', 'other'];
  const legacyWindows = [...constrained.entries()]
    .sort(([a], [b]) => rank.indexOf(a) - rank.indexOf(b))
    .map(([group, quota]) => ({
      id: group,
      label: labelForFamily(group),
      remainingPercent: asPercent(quota.fraction * 100),
      usedPercent: 100 - asPercent(quota.fraction * 100),
      resetsAt: quota.resetsAt,
      detail: `最紧张：${quota.modelId}`,
    }));
  const windows = exactWindows.length ? exactWindows : legacyWindows;
  return {
    id: 'antigravity', label: 'Antigravity', status: windows.length ? 'ok' : 'empty',
    account: identity.email || null, plan: identity.plan || null,
    source: identity.source || 'Antigravity OAuth', updatedAt: now.toISOString(), windows,
    notice: exactWindows.length
      ? '本机服务返回 Gemini 与 Claude/GPT 的 5 小时和每周额度池。'
      : '同一模型家族显示剩余比例最低的文本模型额度，避免高估可用量。',
  };
}

async function refreshCredentials(credentials, fetcher) {
  if (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret) {
    const error = new Error('Antigravity 登录已过期，且凭据中没有可用的 refresh_token 与 OAuth 客户端信息。');
    error.code = 'unauthorized';
    throw error;
  }
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  }).toString();
  const payload = await requestJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'kbu-usage' },
    body,
    fetcher,
  });
  const accessToken = text(payload.access_token);
  if (!accessToken) {
    const error = new Error('Antigravity OAuth 刷新没有返回 access_token。');
    error.code = 'unauthorized';
    throw error;
  }
  return { ...credentials, accessToken, fresh: true };
}

async function providerCredentials(settings, environment, fetcher) {
  let credentials;
  if (settings.authMode === 'local') credentials = loadAntigravityCredentials(environment);
  else credentials = parseOAuthCredentials(resolveProviderSecret('antigravity', settings, environment));
  if (!credentials.found) {
    const error = new Error('未找到 Antigravity OAuth 凭据；可复用 CodexBar 登录，或在设置中提供凭据 JSON。');
    error.code = 'not_configured';
    throw error;
  }
  return credentials.fresh ? credentials : refreshCredentials(credentials, fetcher);
}

function headers(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'antigravity',
  };
}

function planFromCodeAssist(payload) {
  return text(payload?.planInfo?.planType)
    || text(payload?.currentTier?.name)
    || text(payload?.currentTier?.id);
}

function projectFromCodeAssist(payload) {
  const project = payload?.cloudaicompanionProject;
  return text(typeof project === 'string' ? project : project?.id || project?.projectId);
}

export async function fetchAntigravityLimits({
  settings,
  environment = process.env,
  fetcher = fetch,
  run,
  platform,
  localRequester,
} = {}) {
  let localError = null;
  if (settings.authMode === 'local') {
    try {
      const local = await fetchAntigravityLocalQuota({ run, platform, requester: localRequester });
      return parseAntigravityQuota(local.payload, { source: local.source });
    } catch (error) {
      localError = error;
    }
  }
  let credentials;
  try {
    credentials = await providerCredentials(settings, environment, fetcher);
  } catch (error) {
    if (localError && localError.code !== 'not_configured') throw localError;
    throw error;
  }
  const authHeaders = headers(credentials.accessToken);
  const codeAssist = await requestJson(LOAD_CODE_ASSIST_URL, {
    method: 'POST', headers: authHeaders, body: {
      metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' },
    }, fetcher,
  });
  const projectId = credentials.projectId || projectFromCodeAssist(codeAssist);
  const body = projectId ? { project: projectId } : {};
  let quota = await requestJson(MODELS_URL, {
    method: 'POST', headers: authHeaders, body, fetcher,
  }).catch(() => null);
  const needsVerification = !quota || quotaRows(quota).length === 0
    || quotaRows(quota).every((row) => Number(row?.remainingFraction) >= 0.999);
  if (needsVerification) {
    const verified = await requestJson(QUOTA_URL, {
      method: 'POST', headers: authHeaders, body, fetcher,
    }).catch(() => null);
    if (verified) quota = verified;
    else if (quotaRows(quota).every((row) => Number(row?.remainingFraction) >= 0.999)) {
      const error = new Error('Antigravity 无法验证完整额度，为避免误报 100% 已隐藏结果。');
      error.code = 'provider_error';
      throw error;
    }
  }
  if (!quota) {
    const error = new Error('Antigravity 没有返回可用额度数据。');
    error.code = 'invalid_response';
    throw error;
  }
  return parseAntigravityQuota(quota, {
    email: credentials.claims?.email,
    plan: planFromCodeAssist(codeAssist),
    source: settings.authMode === 'local' ? '~/.codexbar/antigravity/oauth_creds.json' : 'Antigravity OAuth JSON',
  });
}
