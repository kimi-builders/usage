import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSessions } from '../src/parsers/index.js';

const events = [
  {
    sessionId: '/private/raw/session-id',
    source: 'kimi-code',
    project: 'project',
    timestamp: new Date('2026-08-01T10:00:00.000Z'),
    role: 'user',
  },
];

test('session identifiers are stable per installation and unlinkable across salts', () => {
  const first = extractSessions(events, 'a'.repeat(32))[0].sessionHash;
  const same = extractSessions(events, 'a'.repeat(32))[0].sessionHash;
  const other = extractSessions(events, 'b'.repeat(32))[0].sessionHash;
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.equal(first.includes('session-id'), false);
});

