import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModelId } from '../src/model-meta.js';

test('Kimi aliases keep their raw identity while gaining a canonical model ID', () => {
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3' }), 'kimi-k3');
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3-256k' }), 'kimi-k3-256k');
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3-256' }), 'kimi-k3-256k');
  assert.equal(
    canonicalModelId({ source: 'kimi-code', model: 'kimi-code/kimi-for-coding' }),
    'kimi-k2.7-code',
  );
  assert.equal(
    canonicalModelId({ source: 'opencode', model: 'kimi-for-coding-highspeed', modelProvider: 'kimiforcoding' }),
    'kimi-k2.7-code-highspeed',
  );
  assert.equal(canonicalModelId({ source: 'opencode', model: 'kimi-k2.6' }), 'kimi-k2.6');
  assert.equal(canonicalModelId({ source: 'opencode', model: 'kimi-k2.5' }), 'kimi-k2.5');
});

test('ambiguous non-Kimi model names are not guessed', () => {
  assert.equal(canonicalModelId({ source: 'opencode', model: 'hy3', modelProvider: 'opencode-go' }), '');
});
