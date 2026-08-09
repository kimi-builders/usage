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

test('session activity keeps calendar hours and splits active time across midnight', () => {
  const result = extractSessions([
    {
      sessionId: 'cross-midnight',
      source: 'codex',
      project: 'project',
      timestamp: new Date('2026-08-01T23:58:00.000Z'),
      role: 'user',
    },
    {
      sessionId: 'cross-midnight',
      source: 'codex',
      project: 'project',
      timestamp: new Date('2026-08-01T23:59:00.000Z'),
      role: 'assistant',
    },
    {
      sessionId: 'cross-midnight',
      source: 'codex',
      project: 'project',
      timestamp: new Date('2026-08-02T00:01:00.000Z'),
      role: 'assistant',
    },
  ], 's'.repeat(32))[0];

  assert.equal(result.durationSeconds, 180);
  assert.equal(result.activeSeconds, 120);
  assert.deepEqual(result.activityHours, [
    {
      hourStart: '2026-08-01T23:00:00.000Z',
      activeSeconds: 60,
      engagedSeconds: 120,
      messageCount: 2,
      userMessageCount: 1,
    },
    {
      hourStart: '2026-08-02T00:00:00.000Z',
      activeSeconds: 60,
      engagedSeconds: 60,
      messageCount: 1,
      userMessageCount: 0,
    },
  ]);
});

test('session timing caps long idle gaps instead of counting offline days', () => {
  const result = extractSessions([
    {
      sessionId: 'reopened-session',
      source: 'claude-code',
      project: 'project',
      timestamp: new Date('2026-08-01T10:00:00.000Z'),
      role: 'user',
    },
    {
      sessionId: 'reopened-session',
      source: 'claude-code',
      project: 'project',
      timestamp: new Date('2026-08-08T10:00:00.000Z'),
      role: 'assistant',
    },
    {
      sessionId: 'reopened-session',
      source: 'claude-code',
      project: 'project',
      timestamp: new Date('2026-08-15T10:00:00.000Z'),
      role: 'assistant',
    },
  ], 's'.repeat(32))[0];

  assert.equal(result.durationSeconds, 3_600);
  assert.equal(result.activeSeconds, 300);
  assert.deepEqual(result.activityHours.at(-2), {
    hourStart: '2026-08-08T10:00:00.000Z',
    messageCount: 1,
    userMessageCount: 0,
    activeSeconds: 300,
    engagedSeconds: 1_800,
  });
  assert.deepEqual(result.activityHours.at(-1), {
    hourStart: '2026-08-15T10:00:00.000Z',
    messageCount: 1,
    userMessageCount: 0,
    activeSeconds: 0,
    engagedSeconds: 0,
  });
});

test('fractional event gaps are rounded once per hour and never exceed the hour limit', () => {
  const base = new Date('2026-08-01T10:00:00.000Z').getTime();
  const fractionalEvents = [
    {
      sessionId: 'fractional-gaps',
      source: 'codex',
      project: 'project',
      timestamp: new Date(base),
      role: 'user',
    },
    {
      sessionId: 'fractional-gaps',
      source: 'codex',
      project: 'project',
      timestamp: new Date(base + 1_000),
      role: 'assistant',
    },
  ];
  for (let index = 1; index <= 13; index += 1) {
    fractionalEvents.push({
      sessionId: 'fractional-gaps',
      source: 'codex',
      project: 'project',
      timestamp: new Date(base + 1_000 + index * 276_500),
      role: 'assistant',
    });
  }

  const result = extractSessions(fractionalEvents, 's'.repeat(32))[0];

  assert.equal(result.activeSeconds, 3_595);
  assert.equal(result.activityHours.reduce((sum, hour) => sum + hour.activeSeconds, 0), 3_595);
  assert.ok(result.activityHours.every((hour) => hour.activeSeconds <= 3_600));
});
