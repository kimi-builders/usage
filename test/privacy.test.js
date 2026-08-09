import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrivacy } from '../src/sync.js';

const snapshot = {
  buckets: [{ source: 'kimi-code', model: 'k3', project: 'secret-project' }],
  sessions: [{ source: 'kimi-code', sessionHash: 'a'.repeat(64), project: 'secret-project' }],
};

test('project is absent, not replaced with a sentinel, when upload is disabled', () => {
  const hidden = applyPrivacy(snapshot, false);
  assert.equal('project' in hidden.buckets[0], false);
  assert.equal('project' in hidden.sessions[0], false);
  assert.equal(snapshot.buckets[0].project, 'secret-project');
});

test('project basename is preserved only when explicitly enabled', () => {
  const visible = applyPrivacy(snapshot, true);
  assert.equal(visible.buckets[0].project, 'secret-project');
  assert.equal(visible.sessions[0].project, 'secret-project');
});

