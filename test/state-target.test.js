import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStateForSync, syncTargetKey } from '../src/state.js';

const first = {
  apiUrl: 'https://kimi.builders',
  apiKey: `kbu_${'a'.repeat(43)}`,
  deviceId: 'device-a',
};

test('an empty checkpoint binds to the current target without requiring a replay confirmation', () => {
  const prepared = prepareStateForSync(first, { state: { buckets: {}, sessions: {} } });
  assert.equal(prepared.reconciliationRequired, false);
  assert.equal(prepared.state.syncTarget, syncTargetKey(first));
  assert.deepEqual(prepared.state.buckets, {});
});

test('legacy or different-target checkpoints require explicit reconciliation', () => {
  const legacy = { buckets: { 'kimi-code|model||date': 'hash' }, sessions: {} };
  const unbound = prepareStateForSync(first, { state: legacy });
  assert.equal(unbound.reconciliationRequired, true);
  assert.deepEqual(unbound.state, legacy);

  const second = { ...first, apiKey: `kbu_${'b'.repeat(43)}`, deviceId: 'device-b' };
  const rebound = prepareStateForSync(second, {
    state: { ...legacy, syncTarget: syncTargetKey(first) },
  });
  assert.equal(rebound.reconciliationRequired, true);
});

test('explicit full sync starts a fresh checkpoint bound to the selected target', () => {
  const prepared = prepareStateForSync(first, {
    full: true,
    state: {
      buckets: { 'codex|model||date': 'hash' },
      sessions: { 'codex|session': 'hash' },
      syncTarget: 'old-target',
    },
  });
  assert.equal(prepared.reconciliationRequired, false);
  assert.deepEqual(prepared.state, {
    buckets: {}, sessions: {}, syncTarget: syncTargetKey(first),
  });
  assert.equal(JSON.stringify(prepared.state).includes(first.apiKey), false);
});
