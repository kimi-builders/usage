import assert from 'node:assert/strict';
import test from 'node:test';
import { moveEnabledProvider, reorderEnabledProviders } from '../src/provider-order.js';

const settings = {
  providerOrder: ['kimi-code', 'claude-code', 'codex', 'cursor', 'warp'],
  providers: {
    'kimi-code': { enabled: true },
    'claude-code': { enabled: false },
    codex: { enabled: true },
    cursor: { enabled: true },
    warp: { enabled: false },
  },
};

test('drag reorders enabled providers without moving disabled provider slots', () => {
  const value = reorderEnabledProviders(settings, 'cursor', 'kimi-code');
  assert.deepEqual(value.providerOrder, ['cursor', 'claude-code', 'kimi-code', 'codex', 'warp']);
  assert.deepEqual(settings.providerOrder, ['kimi-code', 'claude-code', 'codex', 'cursor', 'warp']);
});

test('keyboard movement follows the same enabled-provider order', () => {
  const value = moveEnabledProvider(settings, 'kimi-code', 1);
  assert.deepEqual(value.providerOrder, ['codex', 'claude-code', 'kimi-code', 'cursor', 'warp']);
  assert.equal(moveEnabledProvider(settings, 'kimi-code', -1), settings);
});

test('unknown and disabled drag targets are ignored', () => {
  assert.equal(reorderEnabledProviders(settings, 'unknown', 'codex'), settings);
  assert.equal(reorderEnabledProviders(settings, 'kimi-code', 'claude-code'), settings);
});
