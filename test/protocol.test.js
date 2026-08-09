import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploadBucket, validateUploadSession } from '../src/protocol.js';

const baseSession = {
  source: 'codex',
  sessionHash: 'a'.repeat(64),
  firstMessageAt: '2026-08-01T10:00:00.000Z',
  lastMessageAt: '2026-08-01T10:59:59.999Z',
  durationSeconds: 3_600,
  activeSeconds: 3_600,
  messageCount: 14,
  userMessageCount: 1,
  userPromptHours: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  activityHours: [{
    hourStart: '2026-08-01T10:00:00.000Z',
    activeSeconds: 3_600,
    userMessageCount: 1,
  }],
};

test('upload preflight accepts a valid session at the hourly limit', () => {
  assert.equal(validateUploadSession(baseSession), null);
});

test('upload preflight isolates an activity hour above the server limit', () => {
  const error = validateUploadSession({
    ...baseSession,
    activeSeconds: 3_606,
    activityHours: [{ ...baseSession.activityHours[0], activeSeconds: 3_606 }],
  });
  assert.match(error, /activeSeconds.*3600/);
});

test('upload preflight rejects bucket fields that would poison a batch', () => {
  const error = validateUploadBucket({
    source: 'codex',
    model: 'gpt-5',
    bucketStart: '2026-08-01T10:15:00.000Z',
    inputTokens: 1,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 1,
    reasoningOutputTokens: 0,
    requestCount: 1,
    measurement: 'exact',
  });
  assert.match(error, /30-minute boundary/);
});
