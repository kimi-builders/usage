import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModelId } from '../src/model-meta.js';

test('Kimi aliases keep their raw identity while gaining a canonical model ID', () => {
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3' }), 'kimi-k3');
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3.1-pro' }), 'kimi-k3.1-pro');
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'k3.1-pro-highspeed' }), 'kimi-k3.1-pro-highspeed');
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3-256k' }), 'kimi-k3-256k');
  assert.equal(canonicalModelId({ source: 'kimi-code', model: 'kimi-code/k3-256' }), 'kimi-k3-256k');
  assert.equal(
    canonicalModelId({ source: 'kimi-code', model: 'kimi-code/kimi-for-coding' }),
    'kimi-k2.8-preview',
  );
  assert.equal(
    canonicalModelId({ source: 'kimi-code', model: 'kimi-code/kimi-for-coding', timestamp: '2026-09-10T23:59:59.999Z' }),
    'kimi-k2.7-code',
  );
  assert.equal(
    canonicalModelId({ source: 'kimi-code', model: 'kimi-code/kimi-for-coding', timestamp: '2026-09-11T00:00:00.000Z' }),
    'kimi-k2.8-preview',
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

test('exact model aliases do not depend on the client, gateway or profile label', () => {
  for (const suffix of ['k3.1-pro', 'k3.1-pro-highspeed']) {
    for (const prefix of ['', 'KFC/', 'ABC/', 'team/gateway/配置 A/']) {
      const model = prefix + suffix.toUpperCase();
      assert.equal(canonicalModelId({ model }), 'kimi-' + suffix);
      assert.equal(canonicalModelId({ model, source: 'opencode', modelProvider: 'unrelated',
        modelCanonical: model.toLowerCase() }), 'kimi-' + suffix);
    }
  }
  assert.equal(canonicalModelId({ model: 'ABC/k3.1-pro', modelCanonical: 'custom-model' }), 'custom-model');
  assert.equal(canonicalModelId({ model: 'k3.1-pro/unknown' }), '');
  assert.equal(canonicalModelId({ model: 'custom', modelCanonical: 'ABC/kimi-for-coding',
    bucketStart: '2026-09-10T23:59:59Z' }), 'kimi-k2.7-code');
});
