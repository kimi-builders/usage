import assert from 'node:assert/strict';
import test from 'node:test';
import { browserCommand, deviceAuthorizationGuide } from '../src/init.js';
import { setLocale } from '../src/cli-ui.js';

test('browser authorization uses native launcher commands on each platform', () => {
  const url = 'https://kimi.builders/device';
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
  assert.deepEqual(browserCommand(url, 'win32'), ['cmd', ['/c', 'start', '', url]]);
});

test('first connection guide distinguishes approval from scanning and upload', () => {
  setLocale('zh');
  const lines = deviceAuthorizationGuide({
    expiresIn: 600,
    verificationUriComplete: 'https://kimi.builders/usage/device?code=ABCD-EFGH',
    userCode: 'ABCD-EFGH',
  });
  const output = lines.join('\n');
  assert.match(output, /不扫描、也不上传/);
  assert.match(output, /10 分钟/);
  assert.match(output, /ABCD-EFGH/);
  assert.match(output, /Ctrl\+C/);
  assert.equal(output.includes('deviceCode'), false);
  setLocale('en');
  const english = deviceAuthorizationGuide({
    expiresIn: 600,
    verificationUriComplete: 'https://kimi.builders/usage/device?code=ABCD-EFGH',
    userCode: 'ABCD-EFGH',
  }).join('\n');
  assert.match(english, /does not scan or upload usage/);
  assert.doesNotMatch(english, /不扫描|验证码|等待浏览器/);
  setLocale(null);
});
