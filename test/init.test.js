import assert from 'node:assert/strict';
import test from 'node:test';
import { browserCommand } from '../src/init.js';

test('browser authorization uses native launcher commands on each platform', () => {
  const url = 'https://kimi.builders/device';
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
  assert.deepEqual(browserCommand(url, 'win32'), ['cmd', ['/c', 'start', '', url]]);
});
