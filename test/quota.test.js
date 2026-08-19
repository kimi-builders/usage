import test from 'node:test';
import assert from 'node:assert/strict';
import { formatResetCountdown, normalizeProviderId, renderQuotaReport } from '../src/quota.js';
import { setLocale } from '../src/cli-ui.js';

test('normalizeProviderId handles common aliases', () => {
  assert.equal(normalizeProviderId('claude'), 'claude-code');
  assert.equal(normalizeProviderId('claude-code'), 'claude-code');
  assert.equal(normalizeProviderId('kimi'), 'kimi-code');
  assert.equal(normalizeProviderId('kimi-code'), 'kimi-code');
  assert.equal(normalizeProviderId('codex'), 'codex');
  assert.equal(normalizeProviderId('github'), 'copilot');
  assert.equal(normalizeProviderId('agy'), 'antigravity');
  assert.equal(normalizeProviderId('jetbrains'), 'jetbrains-ai');
  assert.equal(normalizeProviderId(null), null);
});

test('formatResetCountdown formats relative countdowns', () => {
  setLocale('zh');
  const future = new Date(Date.now() + 3600 * 2.5 * 1000).toISOString();
  const res = formatResetCountdown(future);
  assert.match(res, /2.5h 后重置/);

  setLocale('en');
  const resEn = formatResetCountdown(future);
  assert.match(resEn, /resets in 2.5h/);

  setLocale(null);
});

test('renderQuotaReport formats provider windows and progress bars', () => {
  const mockQuotaData = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    providers: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        status: 'ok',
        plan: 'Pro',
        account: 'u•••@anthropic.com',
        windows: [
          {
            id: '5h',
            label: '5 小时窗口',
            usedPercent: 25,
            remainingPercent: 75,
            resetsAt: new Date(Date.now() + 7200 * 1000).toISOString(),
            value: 25,
            limit: 100,
            unit: 'requests',
          },
        ],
        resetCredits: {
          availableCount: 2,
        },
      },
      {
        id: 'deepseek',
        label: 'DeepSeek',
        status: 'error',
        error: {
          code: 'not_configured',
          message: '未检测到可用登录凭据',
        },
      },
    ],
  };

  const report = renderQuotaReport(mockQuotaData);
  assert.match(report, /AI 订阅额度与 Quota 状态/);
  assert.match(report, /Claude Code/);
  assert.match(report, /Pro/);
  assert.match(report, /5 小时窗口/);
  assert.match(report, /75.0%/);
  assert.match(report, /快速重置包: 剩余 2 次/);
  assert.match(report, /DeepSeek/);
  assert.match(report, /未检测到可用登录凭据/);
});
