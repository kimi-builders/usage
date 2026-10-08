import { redactLocalPathsInText, safeLocalPathDisplay } from '../safe-display.js';

const RESULT_STATUSES = new Set(['ok', 'empty']);

/**
 * Machine-readable "why is there no window" vocabulary that may accompany an
 * empty result, aligned with the upstream desktop clients' EmptyReason enums.
 * Additive within contract v1: clients that do not know the field ignore it,
 * and clients that do can render the reason instead of a neutral empty state.
 * Unknown values fail closed instead of passing through silently.
 */
export const PROVIDER_EMPTY_REASONS = Object.freeze([
  'limitReached',
  'noWindow',
  'notEntitled',
  'sessionWithoutPlanLimits',
]);

function invalid(message) {
  const error = new Error(`额度 Provider 返回结构不兼容：${message}`);
  error.code = 'invalid_response';
  return error;
}

function finiteOrNull(value, field) {
  if (value == null) return;
  if (!Number.isFinite(value)) throw invalid(`${field} 必须是有限数字或 null`);
}

function percentOrNull(value, field) {
  finiteOrNull(value, field);
  if (value != null && (value < 0 || value > 100)) throw invalid(`${field} 必须位于 0–100`);
}

function dateOrNull(value, field) {
  if (value == null) return;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(`${field} 必须是 ISO 日期或 null`);
}

function requiredDate(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid(`${field} 必须是 ISO 日期`);
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} 不能为空`);
}

function safeText(value, maxLength) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength) || null;
}

function safeAccount(value) {
  const account = safeText(value, 160);
  if (!account) return null;
  const email = account.match(/^([^@]+)@([^@]+)$/);
  if (email) return `${email[1].slice(0, 1) || '•'}•••@${email[2]}`;
  return account.length <= 4 ? '••••' : `${account.slice(0, 2)}•••${account.slice(-2)}`;
}

function safeDisplayText(value, maxLength) {
  const content = safeText(value, maxLength);
  return content == null ? null : redactLocalPathsInText(safeLocalPathDisplay(content));
}

function validateWindow(window, index, ids) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) throw invalid(`windows[${index}] 必须是对象`);
  text(window.id, `windows[${index}].id`);
  text(window.label, `windows[${index}].label`);
  if (ids.has(window.id)) throw invalid(`窗口 id 重复：${window.id}`);
  ids.add(window.id);

  percentOrNull(window.usedPercent, `windows[${index}].usedPercent`);
  percentOrNull(window.remainingPercent, `windows[${index}].remainingPercent`);
  if (window.usedPercent == null && window.remainingPercent == null) {
    throw invalid(`windows[${index}] 缺少使用或剩余比例`);
  }
  if (window.usedPercent != null && window.remainingPercent != null
    && Math.abs(window.usedPercent + window.remainingPercent - 100) > 0.001) {
    throw invalid(`windows[${index}] 使用与剩余比例之和不是 100`);
  }

  dateOrNull(window.resetsAt, `windows[${index}].resetsAt`);
  finiteOrNull(window.value, `windows[${index}].value`);
  finiteOrNull(window.limit, `windows[${index}].limit`);
  finiteOrNull(window.windowSeconds, `windows[${index}].windowSeconds`);
  if (window.value != null && window.value < 0) throw invalid(`windows[${index}].value 不能为负数`);
  if (window.limit != null && window.limit < 0) throw invalid(`windows[${index}].limit 不能为负数`);
  if (window.windowSeconds != null && window.windowSeconds <= 0) throw invalid(`windows[${index}].windowSeconds 必须大于 0`);
  if ((window.value != null || window.limit != null) && (typeof window.unit !== 'string' || !window.unit.trim())) {
    throw invalid(`windows[${index}] 有数值时必须声明 unit`);
  }
}

function browserWindow(window) {
  return {
    id: safeText(window.id, 160),
    label: safeText(window.label, 160),
    usedPercent: window.usedPercent ?? null,
    remainingPercent: window.remainingPercent ?? null,
    resetsAt: window.resetsAt ?? null,
    windowSeconds: window.windowSeconds ?? null,
    value: window.value ?? null,
    limit: window.limit ?? null,
    unit: safeText(window.unit, 40),
    detail: safeDisplayText(window.detail, 240),
  };
}

function browserResetCredits(resetCredits) {
  if (!resetCredits || typeof resetCredits !== 'object' || Array.isArray(resetCredits)) return null;
  const count = resetCredits.availableCount;
  const expiry = resetCredits.nextExpiry;
  return {
    availableCount: typeof count === 'number' && Number.isFinite(count) && count >= 0
      ? Math.min(1_000_000, Math.floor(count))
      : null,
    nextExpiry: typeof expiry === 'string' && !Number.isNaN(Date.parse(expiry))
      ? new Date(expiry).toISOString()
      : null,
  };
}

function browserBalances(balances) {
  if (balances == null) return [];
  if (!Array.isArray(balances) || balances.length > 16) throw invalid('balances 必须是最多 16 项的数组');
  const currencies = new Set();
  return balances.map((balance, index) => {
    if (!balance || typeof balance !== 'object' || Array.isArray(balance)) {
      throw invalid(`balances[${index}] 必须是对象`);
    }
    const currency = safeText(balance.currency, 3)?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw invalid(`balances[${index}].currency 无效`);
    if (currencies.has(currency)) throw invalid(`balances 币种重复：${currency}`);
    currencies.add(currency);
    const values = ['total', 'granted', 'toppedUp'].map((field) => {
      const value = balance[field];
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) {
        throw invalid(`balances[${index}].${field} 必须是有效的非负金额`);
      }
      return value;
    });
    if (typeof balance.available !== 'boolean') throw invalid(`balances[${index}].available 必须是布尔值`);
    return {
      currency, total: values[0], granted: values[1], toppedUp: values[2],
      available: balance.available,
    };
  });
}

// Optional provider facts are deliberately outside quota windows, money
// balances, and user-declared subscription spend. Raw payloads/IDs never pass.
function browserBenefitFacts(result) {
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
  let creditBalance = null; let cloudCredits = null; let subscriptionDates = null;
  if (result.creditBalance != null) {
    const value = result.creditBalance;
    if (result.id !== 'workbuddy' || !numeric(value.total) || !numeric(value.remaining)
      || value.reserved != null && !numeric(value.reserved)) throw invalid('creditBalance 无效');
    dateOrNull(value.resetsAt, 'creditBalance.resetsAt');
    creditBalance = { total: value.total, remaining: value.remaining, reserved: value.reserved ?? null, resetsAt: value.resetsAt ?? null };
  }
  if (result.cloudCredits != null) {
    const value = result.cloudCredits;
    if (result.id !== 'claude-code' || !numeric(value.limit) || value.limit <= 0 || !numeric(value.remaining)
      || !numeric(value.used) || Math.abs(value.used + value.remaining - value.limit) > 0.000001
      || typeof value.locked !== 'boolean') throw invalid('cloudCredits 无效');
    dateOrNull(value.expiresAt, 'cloudCredits.expiresAt');
    cloudCredits = { limit: value.limit, remaining: value.remaining, used: value.used, locked: value.locked, expiresAt: value.expiresAt ?? null };
  }
  if (result.subscriptionDates != null) {
    if (result.id !== 'claude-code') throw invalid('subscriptionDates 无效');
    dateOrNull(result.subscriptionDates.renewsAt, 'subscriptionDates.renewsAt');
    dateOrNull(result.subscriptionDates.expiresAt, 'subscriptionDates.expiresAt');
    subscriptionDates = { renewsAt: result.subscriptionDates.renewsAt ?? null, expiresAt: result.subscriptionDates.expiresAt ?? null };
  }
  return { creditBalance, cloudCredits, subscriptionDates };
}

/**
 * Enforce the browser-safe shape shared by every subscription quota provider.
 * Provider-specific parsers remain free to add fields, but the stable fields
 * consumed by history and the dashboard must never drift silently.
 */
export function assertProviderContract(expectedId, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalid('结果必须是对象');
  if (result.id !== expectedId) throw invalid(`期望 ${expectedId}，收到 ${String(result.id || '空 id')}`);
  text(result.label, 'label');
  if (!RESULT_STATUSES.has(result.status)) throw invalid(`status ${String(result.status)} 不受支持`);
  if (result.emptyReason != null && !PROVIDER_EMPTY_REASONS.includes(result.emptyReason)) {
    throw invalid(`emptyReason ${String(result.emptyReason)} 不受支持`);
  }
  requiredDate(result.updatedAt, 'updatedAt');
  if (!Array.isArray(result.windows)) throw invalid('windows 必须是数组');
  if (result.status === 'empty' && result.windows.length) throw invalid('empty 结果不能包含额度窗口');
  const ids = new Set();
  result.windows.forEach((window, index) => validateWindow(window, index, ids));
  return {
    id: expectedId,
    label: safeText(result.label, 100),
    status: result.status,
    emptyReason: PROVIDER_EMPTY_REASONS.includes(result.emptyReason) ? result.emptyReason : null,
    account: safeAccount(result.account),
    plan: safeText(result.plan, 160),
    source: safeDisplayText(result.source, 240),
    notice: safeDisplayText(result.notice, 300),
    resetCredits: browserResetCredits(result.resetCredits),
    balances: browserBalances(result.balances),
    ...browserBenefitFacts(result),
    ...(expectedId === 'kimi-code' && /^kimi_[a-f0-9]{32}$/.test(result.historyAccountId || '') ? {
      historyAccountId: result.historyAccountId,
      accountIdentityVerified: result.accountIdentityVerified === true,
      ...(/^key_[a-f0-9]{32}$/.test(result.credentialId || '') ? { credentialId: result.credentialId } : {}),
    } : {}),
    updatedAt: new Date(result.updatedAt).toISOString(),
    windows: result.windows.map(browserWindow),
  };
}
