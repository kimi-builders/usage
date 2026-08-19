import { resolveProviderSecret } from '../credentials.js';
import { requestJson } from '../http.js';

const BALANCE_URL = 'https://api.deepseek.com/user/balance';

function invalid(message) {
  const error = new Error(`DeepSeek 余额响应无效：${message}`);
  error.code = 'invalid_response';
  return error;
}

function balanceNumber(value, field) {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw invalid(`${field} 缺失`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000_000) {
    throw invalid(`${field} 不是有效的非负金额`);
  }
  return number;
}

function currencyCode(value, index) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid(`balance_infos[${index}].currency 无效`);
  return currency;
}

export function parseDeepSeekBalance(payload, {
  now = new Date(), source = 'DeepSeek API Key',
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('响应必须是对象');
  if (typeof payload.is_available !== 'boolean') throw invalid('is_available 必须是布尔值');
  if (!Array.isArray(payload.balance_infos)) throw invalid('balance_infos 必须是数组');
  if (payload.balance_infos.length > 16) throw invalid('balance_infos 条目过多');

  const seen = new Set();
  const balances = payload.balance_infos.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalid(`balance_infos[${index}] 必须是对象`);
    }
    const currency = currencyCode(item.currency, index);
    if (seen.has(currency)) throw invalid(`币种重复：${currency}`);
    seen.add(currency);
    return {
      currency,
      total: balanceNumber(item.total_balance, `balance_infos[${index}].total_balance`),
      granted: balanceNumber(item.granted_balance, `balance_infos[${index}].granted_balance`),
      toppedUp: balanceNumber(item.topped_up_balance, `balance_infos[${index}].topped_up_balance`),
      available: payload.is_available,
    };
  });

  // Match the provider's most useful display order without discarding other
  // currency facts: funded USD, any funded currency, empty USD, then the rest.
  balances.sort((left, right) => {
    const rank = (item) => item.currency === 'USD' && item.total > 0 ? 0
      : item.total > 0 ? 1 : item.currency === 'USD' ? 2 : 3;
    return rank(left) - rank(right) || left.currency.localeCompare(right.currency);
  });

  return {
    id: 'deepseek', label: 'DeepSeek', status: balances.length ? 'ok' : 'empty',
    account: null, plan: 'API credits', source, updatedAt: now.toISOString(),
    windows: [], balances,
    notice: 'DeepSeek 公开 API 只返回账户货币余额，不提供 Token、5 小时或每周额度窗口；本机 DeepSeek 模型用量与余额分别展示。',
  };
}

export async function fetchDeepSeekLimits({
  settings, environment = process.env, fetcher = fetch,
} = {}) {
  const apiKey = resolveProviderSecret('deepseek', settings, environment);
  if (!apiKey) {
    const error = new Error('未找到 DeepSeek API Key。请检查环境变量或 macOS 钥匙串。');
    error.code = 'not_configured';
    throw error;
  }
  const payload = await requestJson(BALANCE_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'kbu-usage' },
    fetcher,
  });
  const source = settings.authMode === 'environment'
    ? 'DeepSeek 环境变量'
    : '本工具 macOS 钥匙串';
  return parseDeepSeekBalance(payload, { source });
}
