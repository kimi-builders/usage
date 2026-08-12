import { homedir } from 'node:os';

function portableBasename(value) {
  return String(value || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'local file';
}

export function isAbsoluteLocalPath(value) {
  const text = String(value || '').trim();
  return text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text) || text.startsWith('\\\\')
    || /^file:\/\//i.test(text);
}

/**
 * Return a useful local-path hint without exposing an absolute filesystem path.
 * Home-owned paths keep their familiar `~/` form; all other absolute paths are
 * reduced to a basename-only hint.
 */
export function safeLocalPathDisplay(value, { home = homedir() } = {}) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('~/')) return text;
  const normalized = text.replaceAll('\\', '/');
  const normalizedHome = String(home || '').replaceAll('\\', '/').replace(/\/$/, '');
  if (normalizedHome && (normalized === normalizedHome || normalized.startsWith(`${normalizedHome}/`))) {
    return `~${normalized.slice(normalizedHome.length)}`;
  }
  return isAbsoluteLocalPath(text) ? `…/${portableBasename(text)}` : text;
}

/** Redact absolute paths embedded inside otherwise useful display text. */
export function redactLocalPathsInText(value, { home = homedir() } = {}) {
  let text = String(value || '');
  const normalizedHome = String(home || '').replaceAll('\\', '/').replace(/\/$/, '');
  if (normalizedHome) text = text.replaceAll(normalizedHome, '~');
  return text
    .replace(/file:\/\/\/[^\s"'<>]+/gi, '[local path]')
    .replace(/\/(?:Users|home|private|tmp|var|opt|etc|Volumes|mnt|srv|root)(?:\/[^\s"'<>]*)*/g, '[local path]')
    .replace(/[A-Za-z]:\\[^\r\n"'<>]+/g, '[local path]');
}
