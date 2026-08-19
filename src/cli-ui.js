import { isatty } from 'node:tty';

// Unicode block elements for sub-character precision bar charts
const BAR_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ANSI escape code constants
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgGray: '\x1b[100m',
};

let forceColorOverride = null;

export function setColorEnabled(enabled) {
  forceColorOverride = enabled === null ? null : Boolean(enabled);
}

export function isColorSupported(stream = process.stdout) {
  if (forceColorOverride !== null) return forceColorOverride;
  if (process.env.NO_COLOR || process.argv.includes('--no-color') || process.argv.includes('--plain')) {
    return false;
  }
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') {
    return true;
  }
  if (process.argv.includes('--color')) {
    return true;
  }
  if (process.env.TERM === 'dumb') {
    return false;
  }
  return Boolean(stream && isatty(stream.fd || 1));
}

export function stripAnsi(text) {
  return String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Calculates visual display width in terminal columns,
 * correctly accounting for ANSI escape codes and East Asian full-width characters.
 */
export function stringWidth(text) {
  const clean = stripAnsi(text);
  let width = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const code = clean.codePointAt(index);
    if (code > 0xffff) {
      index += 1; // surrogate pair
    }
    // Control characters
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      continue;
    }
    // East Asian Wide / Fullwidth characters, emojis, CJK ideographs
    if (
      (code >= 0x1100 && code <= 0x115f) // Hangul Jamo
      || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) // CJK Radicals, Symbols, Han
      || (code >= 0xac00 && code <= 0xd7a3) // Hangul Syllables
      || (code >= 0xf900 && code <= 0xfaff) // CJK Compatibility Ideographs
      || (code >= 0xfe10 && code <= 0xfe19) // Vertical forms
      || (code >= 0xfe30 && code <= 0xfe6f) // CJK Compatibility Forms
      || (code >= 0xff00 && code <= 0xff60) // Fullwidth Forms
      || (code >= 0xffe0 && code <= 0xffe6)
      || (code >= 0x1f300 && code <= 0x1f9ff) // Miscellaneous Symbols and Pictographs, Emoticons
      || (code >= 0x20000 && code <= 0x2fffd) // CJK Extensions
      || (code >= 0x30000 && code <= 0x3fffd)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function wrapColor(code, text) {
  if (!isColorSupported()) return String(text ?? '');
  return `${code}${text}${ANSI.reset}`;
}

export const c = {
  reset: (text) => wrapColor(ANSI.reset, text),
  bold: (text) => wrapColor(ANSI.bold, text),
  dim: (text) => wrapColor(ANSI.dim, text),
  italic: (text) => wrapColor(ANSI.italic, text),
  underline: (text) => wrapColor(ANSI.underline, text),
  black: (text) => wrapColor(ANSI.black, text),
  red: (text) => wrapColor(ANSI.red, text),
  green: (text) => wrapColor(ANSI.green, text),
  yellow: (text) => wrapColor(ANSI.yellow, text),
  blue: (text) => wrapColor(ANSI.blue, text),
  magenta: (text) => wrapColor(ANSI.magenta, text),
  cyan: (text) => wrapColor(ANSI.cyan, text),
  white: (text) => wrapColor(ANSI.white, text),
  gray: (text) => wrapColor(ANSI.gray, text),
  brightRed: (text) => wrapColor(ANSI.brightRed, text),
  brightGreen: (text) => wrapColor(ANSI.brightGreen, text),
  brightYellow: (text) => wrapColor(ANSI.brightYellow, text),
  brightBlue: (text) => wrapColor(ANSI.brightBlue, text),
  brightMagenta: (text) => wrapColor(ANSI.brightMagenta, text),
  brightCyan: (text) => wrapColor(ANSI.brightCyan, text),
  brightWhite: (text) => wrapColor(ANSI.brightWhite, text),
};

export function pad(text, width, align = 'left', fillChar = ' ') {
  const str = String(text ?? '');
  const visualWidth = stringWidth(str);
  if (visualWidth >= width) return str;
  const remaining = width - visualWidth;
  const fill = fillChar.repeat(remaining);
  if (align === 'right') return `${fill}${str}`;
  if (align === 'center') {
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return `${fillChar.repeat(left)}${str}${fillChar.repeat(right)}`;
  }
  return `${str}${fill}`;
}

export function truncate(text, maxWidth, ellipsis = '…') {
  const str = String(text ?? '');
  if (stringWidth(str) <= maxWidth) return str;
  const ellipsisWidth = stringWidth(ellipsis);
  let currentWidth = 0;
  let result = '';
  for (const char of str) {
    const charWidth = stringWidth(char);
    if (currentWidth + charWidth + ellipsisWidth > maxWidth) break;
    result += char;
    currentWidth += charWidth;
  }
  return `${result}${ellipsis}`;
}

/* ==========================================================================
 * Human-Friendly Number & Unit Formatters
 * ========================================================================== */

export function formatTokens(tokens, { compact = true, fixed = 1 } = {}) {
  const value = Number(tokens || 0);
  if (!Number.isFinite(value) || value === 0) return '0';
  if (!compact) return formatNumber(value);
  if (value >= 1e9) return `${(value / 1e9).toFixed(fixed === 1 ? 2 : fixed)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(fixed)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(fixed)}k`;
  return String(Math.round(value));
}

export function formatCurrency(amount, { currency = '$', decimals = 2 } = {}) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return `${currency} 0.00`;
  const symbol = currency ? `${currency} ` : '';
  if (value === 0) return `${symbol}0.00`;
  if (value < 0.01 && value > 0) return `${symbol}<0.01`;
  return `${symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatDuration(seconds, { short = false } = {}) {
  const sec = Number(seconds || 0);
  if (!Number.isFinite(sec) || sec <= 0) return short ? '0s' : '0 秒';
  if (sec < 60) return `${Math.round(sec)}s`;
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = sec / 3600;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}

export function formatPercent(ratio, { decimals = 1, fromFraction = true } = {}) {
  const value = Number(ratio || 0);
  if (!Number.isFinite(value)) return '0.0%';
  const percentage = fromFraction && value <= 1.0 && value >= 0 ? value * 100 : value;
  return `${percentage.toFixed(decimals)}%`;
}

export function formatNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('en-US');
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

/* ==========================================================================
 * Visual Components (Bars, Progress, Tables, Badges, Cards)
 * ========================================================================== */

/**
 * Renders an ASCII sub-character resolution bar chart.
 * E.g. renderBar(4.5, 10, 10) => "████▌"
 */
export function renderBar(value, maxValue, maxWidth = 16, { color = null } = {}) {
  const max = Number(maxValue || 0);
  const val = Number(value || 0);
  if (!Number.isFinite(val) || val <= 0 || !Number.isFinite(max) || max <= 0) return '';
  const ratio = Math.min(Math.max(val / max, 0), 1);
  const totalSubUnits = Math.round(ratio * maxWidth * 8);
  const fullBlocks = Math.floor(totalSubUnits / 8);
  const remainder = totalSubUnits % 8;
  let bar = '█'.repeat(fullBlocks);
  if (remainder > 0 && fullBlocks < maxWidth) {
    bar += BAR_BLOCKS[remainder];
  }
  if (!color || !c[color]) return bar;
  return c[color](bar);
}

/**
 * Renders a standard progress bar.
 * E.g. [████████░░░░░░] 58.0%
 */
export function renderProgressBar(ratio, width = 14, {
  filledChar = '█',
  emptyChar = '░',
  showPercent = true,
  color = 'cyan',
} = {}) {
  const val = Math.min(Math.max(Number(ratio || 0), 0), 1);
  const filledCount = Math.round(val * width);
  const emptyCount = width - filledCount;
  const filledPart = filledChar.repeat(filledCount);
  const emptyPart = emptyChar.repeat(emptyCount);
  const coloredFilled = color && c[color] ? c[color](filledPart) : filledPart;
  const coloredEmpty = c.dim(emptyPart);
  const bar = `[${coloredFilled}${coloredEmpty}]`;
  if (!showPercent) return bar;
  return `${bar} ${formatPercent(val, { decimals: 1, fromFraction: true })}`;
}

export function renderStatusBadge(status) {
  switch (status) {
    case 'ok':
    case 'success':
      return `${c.green('✓')} ${c.green('正常')}`;
    case 'skipped':
      return `${c.gray('-')} ${c.gray('跳过')}`;
    case 'partial':
      return `${c.yellow('~')} ${c.yellow('部分')}`;
    case 'failed':
    case 'error':
      return `${c.red('✗')} ${c.red('失败')}`;
    case 'running':
      return `${c.cyan('⚡')} ${c.cyan('运行中')}`;
    default:
      return `${c.dim('•')} ${status}`;
  }
}

/**
 * Clean, modern table renderer with auto-align, borders, and ANSI safety.
 */
export function renderTable({
  columns = [],
  rows = [],
  divider = '─',
  headerDivider = true,
  bottomDivider = true,
} = {}) {
  if (columns.length === 0) return '';
  const widths = columns.map((col) => {
    let max = stringWidth(col.header || '');
    for (const row of rows) {
      const val = Array.isArray(row) ? row[col.index ?? 0] : row[col.key];
      const strVal = col.format ? col.format(val, row) : String(val ?? '');
      const width = stringWidth(strVal);
      if (width > max) max = width;
    }
    if (col.minWidth && max < col.minWidth) max = col.minWidth;
    if (col.maxWidth && max > col.maxWidth) max = col.maxWidth;
    return max;
  });

  const lines = [];
  const renderRow = (cells, isHeader = false) => cells.map((cell, idx) => {
    const col = columns[idx];
    const str = String(cell ?? '');
    const align = col.align || 'left';
    return pad(str, widths[idx], align);
  }).join('  ');

  // Header
  const headerCells = columns.map((col) => (isColorSupported() ? c.bold(col.header || '') : (col.header || '')));
  lines.push(`  ${renderRow(headerCells, true)}`);

  const totalWidth = widths.reduce((sum, w) => sum + w, 0) + (columns.length - 1) * 2 + 2;
  const horizontalLine = c.dim(divider.repeat(totalWidth));

  if (headerDivider) {
    lines.push(horizontalLine);
  }

  // Rows
  for (const row of rows) {
    const cells = columns.map((col, idx) => {
      const raw = Array.isArray(row) ? row[idx] : row[col.key];
      return col.format ? col.format(raw, row) : String(raw ?? '');
    });
    lines.push(`  ${renderRow(cells)}`);
  }

  if (bottomDivider) {
    lines.push(horizontalLine);
  }

  return lines.join('\n');
}

/**
 * Terminal spinner for animated feedback during CLI actions.
 */
export function createSpinner(initialText = '') {
  let text = initialText;
  let timer = null;
  let frameIndex = 0;
  const isInteractive = Boolean(process.stdout.isTTY && !process.env.CI && isColorSupported());

  const render = () => {
    if (!isInteractive) return;
    const frame = c.cyan(SPINNER_FRAMES[frameIndex]);
    process.stdout.write(`\r${frame} ${text} `);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  const clear = () => {
    if (!isInteractive) return;
    process.stdout.write('\r\x1b[2K');
  };

  return {
    start(newText) {
      if (newText) text = newText;
      if (!isInteractive) {
        if (text) console.log(`${c.cyan('•')} ${text}`);
        return this;
      }
      if (timer) clearInterval(timer);
      frameIndex = 0;
      render();
      timer = setInterval(render, 80);
      return this;
    },
    update(newText) {
      text = newText;
      return this;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      clear();
      return this;
    },
    succeed(msg) {
      this.stop();
      console.log(`${c.green('✓')} ${msg || text}`);
      return this;
    },
    fail(msg) {
      this.stop();
      console.log(`${c.red('✗')} ${msg || text}`);
      return this;
    },
    warn(msg) {
      this.stop();
      console.log(`${c.yellow('⚠')} ${msg || text}`);
      return this;
    },
    info(msg) {
      this.stop();
      console.log(`${c.blue('ℹ')} ${msg || text}`);
      return this;
    },
  };
}
