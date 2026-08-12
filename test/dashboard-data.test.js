import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardData } from '../src/local/dashboard-data.js';

const snapshot = {
  schemaVersion: 1,
  generatedAt: '2026-08-11T00:00:00.000Z',
  locality: { mode: 'local-only', networkRequests: 0, sessionIdentity: 'installation-stable' },
  sources: [{
    source: 'kimi-code', tier: 'core', status: 'ok', roots: ['/Users/private/.kimi'],
    bucketCount: 1, sessionCount: 1,
  }],
  summary: {
    bucketCount: 1, sessionCount: 1, inputTokens: 10, cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0,
    totalTokens: 12, requestCount: 1, messageCount: 2, userMessageCount: 1,
    activeSeconds: 0, engagedSeconds: 60, firstActivityAt: '2026-08-10T10:00:00.000Z',
    lastActivityAt: '2026-08-10T10:30:00.000Z', coverage: {},
  },
  diagnostics: {
    parsedBuckets: 1, parsedSessions: 1, acceptedBuckets: 1, acceptedSessions: 1, rejected: [],
  },
  data: {
    buckets: [{
      source: 'kimi-code', model: 'kimi-code/k3', modelCanonical: 'kimi-k3',
      project: 'secret-project', bucketStart: '2026-08-10T10:00:00.000Z',
      inputTokens: 10, cacheWriteInputTokens: 0, cacheReadInputTokens: 0,
      outputTokens: 2, reasoningOutputTokens: 0, requestCount: 1, measurement: 'exact',
    }],
    sessions: [{
      source: 'kimi-code', project: 'secret-project', sessionHash: 'a'.repeat(64),
      firstMessageAt: '2026-08-10T10:00:00.000Z', lastMessageAt: '2026-08-10T10:01:00.000Z',
      durationSeconds: 60, activeSeconds: 0, messageCount: 2, userMessageCount: 1,
      userPromptHours: new Array(24).fill(0),
      activityHours: [{
        hourStart: '2026-08-10T10:00:00.000Z', activeSeconds: 0, engagedSeconds: 60,
        messageCount: 2, userMessageCount: 1,
      }],
    }],
  },
};

test('dashboard payload keeps useful local dimensions but removes secrets and roots', () => {
  const data = createDashboardData(snapshot, {
    config: { apiUrl: 'https://kimi.builders', apiKey: 'kbu_super-secret', sessionSalt: 'safe-session-salt' },
    device: { terminal: { name: 'Warp' }, os: { name: 'macOS' } },
    agentVersions: { 'kimi-code': '1.2.3' },
  });
  assert.equal(data.community.connected, true);
  assert.equal(data.buckets[0].project, 'secret-project');
  assert.equal(data.sessions[0].sessionHash, undefined);
  assert.equal(data.sources[0].rootCount, 1);
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('/Users/private'), false);
  assert.equal(serialized.includes('kbu_super-secret'), false);
  assert.equal(serialized.includes('a'.repeat(64)), false);
  assert.equal(data.activityHours[0].engagedSeconds, 60);
});

test('dashboard community status uses the same connection predicate as sync', () => {
  const missingSalt = createDashboardData(snapshot, {
    config: { apiUrl: 'https://kimi.builders', apiKey: 'kbu_super-secret' },
    device: { terminal: { name: 'Warp' }, os: { name: 'macOS' } },
    agentVersions: {},
  });
  const missingKey = createDashboardData(snapshot, {
    config: { apiUrl: 'https://kimi.builders', sessionSalt: 'safe-session-salt' },
    device: { terminal: { name: 'Warp' }, os: { name: 'macOS' } },
    agentVersions: {},
  });
  assert.equal(missingSalt.community.connected, false);
  assert.equal(missingKey.community.connected, false);
});
