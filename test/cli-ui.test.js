import test from 'node:test';
import assert from 'node:assert/strict';
import {
  c,
  formatBytes,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTokens,
  pad,
  renderBar,
  renderProgressBar,
  renderStatusBadge,
  renderTable,
  setColorEnabled,
  stringWidth,
  stripAnsi,
  truncate,
} from '../src/cli-ui.js';

test('formatTokens formats compact and readable units', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(450), '450');
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(620500), '620.5k');
  assert.equal(formatTokens(48200000), '48.2M');
  assert.equal(formatTokens(1420000000), '1.42B');
  assert.equal(formatTokens(1234567, { compact: false }), '1,234,567');
});

test('formatCurrency formats amounts safely', () => {
  assert.equal(formatCurrency(0), '$ 0.00');
  assert.equal(formatCurrency(0.002), '$ <0.01');
  assert.equal(formatCurrency(12.45), '$ 12.45');
  assert.equal(formatCurrency(1234.5, { currency: '¥' }), '¥ 1,234.50');
});

test('formatDuration formats seconds accurately', () => {
  assert.equal(formatDuration(0), '0 秒');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(300), '5min');
  assert.equal(formatDuration(3600), '1.0h');
  assert.equal(formatDuration(66600), '18.5h');
  assert.equal(formatDuration(90000), '1d 1h');
});

test('formatPercent formats fractions and raw percentages', () => {
  assert.equal(formatPercent(0.582), '58.2%');
  assert.equal(formatPercent(1), '100.0%');
  assert.equal(formatPercent(72.5, { fromFraction: false }), '72.5%');
});

test('stringWidth and stripAnsi handle ANSI and CJK characters properly', () => {
  const colored = '\x1b[32mhello\x1b[0m';
  assert.equal(stripAnsi(colored), 'hello');
  assert.equal(stringWidth(colored), 5);

  const cjk = '来源扫描';
  assert.equal(stringWidth(cjk), 8);

  const mixed = '\x1b[1m✓ 正常\x1b[0m (ok)';
  // '✓' is 1 or 2 depending on unicode, ' ' is 1, '正常' is 4, ' (ok)' is 5
  assert.ok(stringWidth(mixed) >= 10);
});

test('pad aligns strings by visual width', () => {
  assert.equal(pad('abc', 6, 'left'), 'abc   ');
  assert.equal(pad('abc', 6, 'right'), '   abc');
  assert.equal(pad('中文', 8, 'left'), '中文    ');
  assert.equal(pad('中文', 8, 'right'), '    中文');
});

test('truncate truncates by visual width with ellipsis', () => {
  assert.equal(truncate('hello world', 8), 'hello w…');
  assert.equal(truncate('一二三四五六', 6), '一二…');
});

test('renderBar and renderProgressBar render expected bars', () => {
  setColorEnabled(false);
  try {
    const bar = renderBar(5, 10, 10);
    assert.equal(bar, '█████');

    const progress = renderProgressBar(0.5, 10, { showPercent: true });
    assert.equal(progress, '[█████░░░░░] 50.0%');
  } finally {
    setColorEnabled(null);
  }
});

test('renderTable produces cleanly aligned columns', () => {
  setColorEnabled(false);
  try {
    const columns = [
      { key: 'source', header: '来源', align: 'left' },
      { key: 'tokens', header: 'Token', align: 'right', format: (val) => formatTokens(val) },
      { key: 'cost', header: '费用', align: 'right', format: (val) => formatCurrency(val) },
    ];
    const rows = [
      { source: 'claude-code', tokens: 48200000, cost: 12.45 },
      { source: 'kimi-code', tokens: 31600000, cost: 4.2 },
    ];
    const table = renderTable({ columns, rows });
    const lines = table.split('\n');
    assert.ok(lines.length >= 4);
    assert.match(lines[0], /来源\s+Token\s+费用/);
    assert.match(lines[2], /claude-code\s+48\.2M\s+\$\s+12\.45/);
    assert.match(lines[3], /kimi-code\s+31\.6M\s+\$\s+4\.20/);
  } finally {
    setColorEnabled(null);
  }
});
