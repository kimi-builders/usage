import {
  loadAntigravityCredentials, parseOAuthCredentials, resolveProviderSecret,
} from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

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
  const models = payload?.models && typeof payload.models === 'object' ? payload.models : {};
  return Object.entries(models).map(([modelId, model]) => ({
    modelId,
    label: model?.displayName || model?.label || modelId,
    remainingFraction: model?.quotaInfo?.remainingFraction,
    resetTime: model?.quotaInfo?.resetTime,
  }));
}

export function parseAntigravityQuota(payload, identity = {}, { now = new Date() } = {}) {
  const rows = quotaRows(payload).filter((row) => text(row?.modelId)
    && Number.isFinite(Number(row?.remainingFraction)));
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
  const windows = [...constrained.entries()]
    .sort(([a], [b]) => rank.indexOf(a) - rank.indexOf(b))
    .map(([group, quota]) => ({
      id: group,
      label: labelForFamily(group),
      remainingPercent: asPercent(quota.fraction * 100),
      usedPercent: 100 - asPercent(quota.fraction * 100),
      resetsAt: quota.resetsAt,
      detail: `最紧张：${quota.modelId}`,
    }));
  return {
    id: 'antigravity', label: 'Antigravity', status: windows.length ? 'ok' : 'empty',
    account: identity.email || null, plan: identity.plan || null,
    source: identity.source || 'Antigravity OAuth', updatedAt: now.toISOString(), windows,
    notice: '同一模型家族显示剩余比例最低的额度，避免高估可用量。',
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

export async function fetchAntigravityLimits({ settings, environment = process.env, fetcher = fetch } = {}) {
  const credentials = await providerCredentials(settings, environment, fetcher);
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
