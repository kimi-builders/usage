import { loadGeminiCredentials } from '../credentials.js';
import { asDate, asPercent, requestJson } from '../http.js';

const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

function modelLabel(modelId) {
  return String(modelId || '')
    .replace(/^models\//, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function parseGeminiQuota(payload, credentials, { now = new Date() } = {}) {
  if (!Array.isArray(payload?.buckets) || payload.buckets.length === 0) {
    const error = new Error('Gemini 返回数据中没有 quota buckets。');
    error.code = 'invalid_response';
    throw error;
  }
  const constrained = new Map();
  for (const bucket of payload.buckets) {
    const id = String(bucket?.modelId || '').trim();
    const fraction = Number(bucket?.remainingFraction);
    if (!id || !Number.isFinite(fraction)) continue;
    const current = constrained.get(id);
    if (!current || fraction < current.fraction) constrained.set(id, {
      fraction,
      resetsAt: asDate(bucket?.resetTime),
    });
  }
  const windows = [...constrained.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, quota]) => ({
      id,
      label: modelLabel(id),
      remainingPercent: asPercent(quota.fraction * 100),
      usedPercent: 100 - asPercent(quota.fraction * 100),
      resetsAt: quota.resetsAt,
    }));
  return {
    id: 'gemini-cli', label: 'Gemini CLI', status: windows.length ? 'ok' : 'empty',
    account: credentials.claims?.email || null, plan: credentials.plan || null,
    source: '~/.gemini/oauth_creds.json', updatedAt: now.toISOString(), windows,
    notice: '同一模型有多个桶时显示剩余比例最低的一项，避免高估可用额度。',
  };
}

export async function fetchGeminiLimits({ environment = process.env, fetcher = fetch } = {}) {
  const credentials = loadGeminiCredentials(environment);
  if (!credentials.found || !credentials.fresh) {
    const error = new Error(credentials.found
      ? 'Gemini CLI 登录已过期，请重新登录后刷新。'
      : '未找到 Gemini CLI OAuth 登录。');
    error.code = credentials.found ? 'unauthorized' : 'not_configured';
    throw error;
  }
  const headers = {
    Authorization: `Bearer ${credentials.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'kbu-usage',
  };
  const codeAssist = await requestJson(CODE_ASSIST_URL, {
    method: 'POST', headers,
    body: { metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } },
    fetcher,
  }).catch(() => null);
  const project = codeAssist?.cloudaicompanionProject;
  const projectId = typeof project === 'string' ? project : project?.id || project?.projectId;
  const payload = await requestJson(QUOTA_URL, {
    method: 'POST',
    headers,
    body: projectId ? { project: projectId } : {},
    fetcher,
  });
  return parseGeminiQuota(payload, {
    ...credentials,
    plan: codeAssist?.paidTier?.name || codeAssist?.currentTier?.name || codeAssist?.currentTier?.id,
  });
}
