import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPrivacy } from '../src/sync.js';
import { bucketKey, contentHash } from '../src/state.js';

function bucket(project, inputTokens, extra = {}) {
  return {
    source: 'codex',
    model: 'gpt-5.6-sol',
    modelCanonical: 'gpt-5.6-sol',
    modelProvider: 'openai',
    project,
    bucketStart: '2026-08-10T10:00:00.000Z',
    inputTokens,
    cacheWriteInputTokens: 2,
    cacheWrite5mInputTokens: 1,
    cacheReadInputTokens: 3,
    outputTokens: 4,
    reasoningOutputTokens: 5,
    requestCount: 1,
    measurement: 'exact',
    ...extra,
  };
}

test('private sync merges projects at the final wire grain before checkpointing', () => {
  const result = applyPrivacy({
    buckets: [bucket('community', 10), bucket('collector', 20)],
    sessions: [],
  }, false);

  assert.equal(result.buckets.length, 1);
  const expected = bucket('ignored', 30);
  delete expected.project;
  assert.deepEqual(result.buckets[0], {
    ...expected,
    cacheWriteInputTokens: 4,
    cacheWrite5mInputTokens: 2,
    cacheReadInputTokens: 6,
    outputTokens: 8,
    reasoningOutputTokens: 10,
    requestCount: 2,
  });
  assert.equal('project' in result.buckets[0], false);

  const state = { [bucketKey(result.buckets[0])]: contentHash(result.buckets[0]) };
  const repeated = applyPrivacy({
    buckets: [bucket('community', 10), bucket('collector', 20)],
    sessions: [],
  }, false);
  assert.equal(state[bucketKey(repeated.buckets[0])], contentHash(repeated.buckets[0]));
});

test('private sync treats an omitted optional cache TTL partition as zero', () => {
  const withoutFiveMinute = bucket('community', 10);
  delete withoutFiveMinute.cacheWrite5mInputTokens;
  const withFiveMinute = bucket('collector', 20, {
    cacheWriteInputTokens: 7,
    cacheWrite5mInputTokens: 6,
  });

  const result = applyPrivacy({
    // Keep the omitted value first: this is the ordering that previously made
    // undefined + a later TTL value fail before upload validation could run.
    buckets: [withoutFiveMinute, withFiveMinute],
    sessions: [],
  }, false);

  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].cacheWriteInputTokens, 9);
  assert.equal(result.buckets[0].cacheWrite5mInputTokens, 6);
});

test('public sync preserves project buckets and private merging never combines metadata variants', () => {
  const publicResult = applyPrivacy({
    buckets: [bucket('community', 10), bucket('collector', 20)],
    sessions: [],
  }, true);
  assert.equal(publicResult.buckets.length, 2);

  const privateResult = applyPrivacy({
    buckets: [
      bucket('community', 10, { reasoningEffort: 'high' }),
      bucket('collector', 20, { reasoningEffort: 'xhigh' }),
    ],
    sessions: [],
  }, false);
  assert.equal(privateResult.buckets.length, 2);
});
