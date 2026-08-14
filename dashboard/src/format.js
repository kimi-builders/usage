export const SOURCE_LABELS = {
  'kimi-code': 'Kimi Code',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  'gemini-cli': 'Gemini CLI',
  antigravity: 'antigravity',
  'copilot-cli': 'Copilot CLI',
  'roo-code': 'Roo Code',
  'pi-coding-agent': 'Pi',
  zcode: 'ZCode',
  workbuddy: 'WorkBuddy',
  cursor: 'Cursor',
};

export function compact(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(value).toUpperCase();
}

export function integer(value) {
  return new Intl.NumberFormat('en-US').format(Math.round(value || 0));
}

export function pluralUnit(value, singular, plural = `${singular}s`) {
  return Number(value) === 1 ? singular : plural;
}

export function money(micros, digits = 2) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format((micros || 0) / 1_000_000);
}

export function usdMoney(micros, digits) {
  const value = (micros || 0) / 1_000_000;
  const precision = digits ?? (Math.abs(value) >= 0.01 ? 2 : 4);
  return `USD ${value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })}`;
}

export function distributionShare(rows, row, metric = 'tokens') {
  const field = metric === 'cost' ? 'costMicros' : 'totalTokens';
  const total = rows.reduce((sum, item) => sum + (item[field] || 0), 0);
  return total > 0 ? (row[field] || 0) / total : 0;
}

export function percent(value, digits = 1) {
  const effectiveDigits = value > .999 && value < 1 ? Math.max(2, digits) : digits;
  return `${((value || 0) * 100).toFixed(effectiveDigits)}%`;
}

export function duration(seconds, zh = true) {
  const hours = Math.floor((seconds || 0) / 3600);
  const minutes = Math.floor(((seconds || 0) % 3600) / 60);
  return zh ? `${hours}时 ${minutes}分` : `${hours}h ${minutes}m`;
}

export function dateTime(value, zh = true) {
  return new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function delta(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

/* 展示层币种。CNY/USD 由同日 ECB EUR 参考价交叉计算：
   CNY per EUR ÷ USD per EUR。只影响展示，不改美元存储与估费口径；
   ECB 明确说明参考汇率仅供信息用途，不应视为交易价格。 */
export const DISPLAY_FX_AS_OF = '2026-08-13';
export const DISPLAY_FX_SOURCE = 'ECB reference rates · CNY/EUR ÷ USD/EUR';
export const DISPLAY_FX_SOURCE_URL = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';
export const DISPLAY_CURRENCIES = {
  usd: { rate: 1, symbol: '$', label: 'USD' },
  cny: { rate: 6.743, symbol: '¥', label: 'CNY' },
};

export function displayMoney(micros, currency = 'usd', digits = 2) {
  const spec = DISPLAY_CURRENCIES[currency] || DISPLAY_CURRENCIES.usd;
  const value = (micros || 0) / 1e6 * spec.rate;
  return `${spec.symbol}${value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/* 坐标轴等窄位的紧凑币种格式:$3.7k / ¥26.5k。 */
export function compactMoney(micros, currency = 'usd') {
  const spec = DISPLAY_CURRENCIES[currency] || DISPLAY_CURRENCIES.usd;
  return `${spec.symbol}${compact((micros || 0) / 1e6 * spec.rate)}`;
}

/* 预算等以「美元」为单位的数值(非 micros)。 */
export function displayDollars(value, currency = 'usd', digits = 2) {
  const spec = DISPLAY_CURRENCIES[currency] || DISPLAY_CURRENCIES.usd;
  const scaled = (Number(value) || 0) * spec.rate;
  return `${spec.symbol}${scaled.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
