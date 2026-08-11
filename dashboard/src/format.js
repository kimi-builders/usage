export const SOURCE_LABELS = {
  'kimi-code': 'Kimi Code',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  'gemini-cli': 'Gemini CLI',
  antigravity: 'antigravity',
  'copilot-cli': 'Copilot CLI',
  'roo-code': 'Roo Code',
  cursor: 'Cursor',
};

export function compact(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(value).toUpperCase();
}

export function integer(value) {
  return new Intl.NumberFormat('en-US').format(Math.round(value || 0));
}

export function money(micros, digits = 2) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format((micros || 0) / 1_000_000);
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
