import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSystemLocale, getLocale, setLocale, t } from '../src/i18n.js';
import { run } from '../src/index.js';

test('i18n translates messages in zh and en', () => {
  setLocale('zh');
  assert.equal(getLocale(), 'zh');
  assert.equal(t('status.ok'), '正常');
  assert.equal(t('sync.synced', { buckets: 5, sessions: 2 }), '已同步 5 buckets · 2 sessions');

  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('status.ok'), 'OK');
  assert.equal(t('sync.synced', { buckets: 5, sessions: 2 }), 'Synced 5 buckets · 2 sessions');

  // Reset to default
  setLocale(null);
});

test('i18n supports manual and environment locale detection', () => {
  assert.equal(detectSystemLocale({ KBU_USAGE_LANG: 'en' }), 'en');
  assert.equal(detectSystemLocale({ KBU_USAGE_LANG: 'zh' }), 'zh');
  assert.equal(detectSystemLocale({}), 'zh');
});

test('cli status outputs styled system overview', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await run(['status', '--plain']);
  } finally {
    console.log = original;
  }
  const text = lines.join('\n');
  assert.match(text, /Kimi Builders Usage/);
  assert.match(text, /社区同步服务/);
  assert.match(text, /本地数据引擎/);
});

test('sources list supports --json flag', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await run(['sources', 'list', '--json']);
  } finally {
    console.log = original;
  }
  const parsed = JSON.parse(lines.join('\n'));
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.some((item) => item.id === 'kimi-code'));
  assert.ok(parsed.some((item) => item.id === 'claude-code'));
});
