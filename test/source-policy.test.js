import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySourcePolicies, effectiveSourcePolicies, newInstallSourcePolicies, sourceIdsFor,
} from '../src/source-policy.js';

const registry = [
  { id: 'kimi-code', tier: 'core' },
  { id: 'codex', tier: 'stable' },
  { id: 'new-agent', tier: 'beta' },
  { id: 'cursor', tier: 'explicit-opt-in' },
];

test('legacy connected installs preserve their previous private sync behavior', () => {
  const config = { apiKey: 'kbu_fixture', sessionSalt: 'x'.repeat(32), enabledSources: ['cursor'] };
  assert.deepEqual(effectiveSourcePolicies(config, registry), {
    'kimi-code': 'private', codex: 'private', 'new-agent': 'private', cursor: 'private',
  });
});

test('legacy local installs scan automatic sources without syncing them', () => {
  const config = { sessionSalt: 'x'.repeat(32) };
  assert.deepEqual(sourceIdsFor(config, 'scan', registry), ['kimi-code', 'codex', 'new-agent']);
  assert.deepEqual(sourceIdsFor(config, 'sync', registry), []);
});

test('explicit policies keep new automatic sources local-only and explicit sources off', () => {
  const config = {
    apiKey: 'kbu_fixture', sessionSalt: 'x'.repeat(32),
    sourcePolicies: { 'kimi-code': 'private', codex: 'off' },
  };
  assert.deepEqual(effectiveSourcePolicies(config, registry), {
    'kimi-code': 'private', codex: 'off', 'new-agent': 'local', cursor: 'off',
  });
  assert.deepEqual(sourceIdsFor(config, 'scan', registry), ['kimi-code', 'new-agent']);
  assert.deepEqual(sourceIdsFor(config, 'sync', registry), ['kimi-code']);
});

test('policy updates validate modes and preserve unrelated source choices', () => {
  const current = applySourcePolicies({}, { 'kimi-code': 'private', codex: 'off' }, registry);
  const next = applySourcePolicies(current, { codex: 'local', cursor: 'local' }, registry);
  assert.equal(next.sourcePolicyVersion, 1);
  assert.deepEqual(next.sourcePolicies, {
    'kimi-code': 'private', codex: 'local', 'new-agent': 'local', cursor: 'local',
  });
  assert.deepEqual(next.enabledSources, ['cursor']);
  assert.throws(() => applySourcePolicies({}, { codex: 'public' }, registry), /Invalid source mode/);
  assert.throws(() => applySourcePolicies({}, { mystery: 'off' }, registry), /Unknown usage source/);
});

test('new connected installs remain local unless init --sync is explicit', () => {
  assert.deepEqual(newInstallSourcePolicies({}, registry), {
    'kimi-code': 'local', codex: 'local', 'new-agent': 'local', cursor: 'off',
  });
  assert.deepEqual(newInstallSourcePolicies({ sync: true }, registry), {
    'kimi-code': 'private', codex: 'private', 'new-agent': 'private', cursor: 'off',
  });
});
