const RESULT_STATUSES = new Set(['ok', 'empty']);

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
  requiredDate(result.updatedAt, 'updatedAt');
  if (!Array.isArray(result.windows)) throw invalid('windows 必须是数组');
  if (result.status === 'empty' && result.windows.length) throw invalid('empty 结果不能包含额度窗口');
  const ids = new Set();
  result.windows.forEach((window, index) => validateWindow(window, index, ids));
  return result;
}
