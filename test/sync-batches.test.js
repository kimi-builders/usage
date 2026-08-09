import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkBucketChanges } from '../src/sync.js';

function change(index, extra = {}) {
  return {
    item: {
      source: 'codex',
      model: `gpt-${index}`,
      project: 'demo',
      bucketStart: '2026-08-01T10:00:00.000Z',
      ...extra,
    },
    key: String(index),
    hash: String(index),
  };
}

test('metadata variants of one old bucket stay together across batch boundaries', () => {
  const unrelated = Array.from({ length: 4 }, (_, index) => change(index));
  const emptyVariant = change('shared', { model: 'gpt-shared' });
  const richVariant = change('shared-rich', {
    model: 'gpt-shared',
    reasoningEffort: 'high',
    agentVersion: '0.146.1',
  });
  const chunks = chunkBucketChanges([...unrelated, emptyVariant, richVariant], 5);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[1].map(({ item }) => item.reasoningEffort || ''), ['high', '']);
});
