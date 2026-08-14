import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectLocalSnapshot,
  publicDoctorReport,
} from '../src/local/snapshot.js';
import { observedTokenTotal, summarizeUsage } from '../src/local/metrics.js';

const hourStart = '2026-08-10T10:00:00.000Z';
const bucketStart = '2026-08-10T10:00:00.000Z';

function promptHours() {
  const values = new Array(24).fill(0);
  values[10] = 1;
  return values;
}

function validBucket(overrides = {}) {
  return {
    source: 'kimi-code',
    model: 'kimi-code/k3',
    modelCanonical: 'kimi-k3',
    reasoningEffort: 'high',
    agentVersion: '1.2.3',
    project: 'private-project',
    bucketStart,
    inputTokens: 10,
    cacheWriteInputTokens: 2,
    cacheReadInputTokens: 3,
    outputTokens: 4,
    reasoningOutputTokens: 5,
    requestCount: 1,
    measurement: 'exact',
    ...overrides,
  };
}

function validSession() {
  return {
    source: 'kimi-code',
    project: 'private-project',
    sessionHash: 'a'.repeat(64),
    firstMessageAt: '2026-08-10T10:00:00.000Z',
    lastMessageAt: '2026-08-10T10:01:00.000Z',
    durationSeconds: 60,
    activeSeconds: 0,
    messageCount: 2,
    userMessageCount: 1,
    userPromptHours: promptHours(),
    activityHours: [{
      hourStart,
      activeSeconds: 0,
      engagedSeconds: 60,
      messageCount: 2,
      userMessageCount: 1,
    }],
  };
}

function sourceEntries() {
  return [
    {
      id: 'kimi-code',
      tier: 'core',
      roots: async () => ['/Users/secret/.kimi-code'],
      parse: async () => ({
        buckets: [validBucket(), validBucket({ outputTokens: -1 })],
        sessions: [validSession()],
      }),
    },
    {
      id: 'claude-code',
      tier: 'stable',
      roots: async () => [],
      parse: async () => { throw new Error('must not parse an absent source'); },
    },
    {
      id: 'codex',
      tier: 'stable',
      roots: async () => ['/Users/secret/.codex'],
      parse: async () => { throw new Error('fixture parser failure'); },
    },
    {
      id: 'opencode',
      tier: 'stable',
      roots: async () => ['/Users/secret/opencode'],
      parse: async () => ({ skipped: true, buckets: [], sessions: [], warnings: ['locked'] }),
    },
  ];
}

test('local snapshot is network-free, validates rows, and preserves source isolation', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network access is forbidden'); };
  try {
    const snapshot = await collectLocalSnapshot({
      sessionSalt: 'local-snapshot-test-salt'.padEnd(32, 'x'),
      sourceEntries: sourceEntries(),
      generatedAt: new Date('2026-08-10T12:00:00.000Z'),
    });
    assert.equal(snapshot.schemaVersion, 1);
    assert.deepEqual(snapshot.locality, {
      mode: 'local-only',
      networkRequests: 0,
      sessionIdentity: 'installation-stable',
    });
    assert.deepEqual(
      snapshot.sources.map(({ source, status }) => ({ source, status })),
      [
        { source: 'kimi-code', status: 'ok' },
        { source: 'claude-code', status: 'skipped' },
        { source: 'codex', status: 'failed' },
        { source: 'opencode', status: 'partial' },
      ],
    );
    assert.deepEqual(snapshot.sources[2].roots, ['/Users/secret/.codex']);
    assert.equal(snapshot.diagnostics.parsedBuckets, 2);
    assert.equal(snapshot.diagnostics.acceptedBuckets, 1);
    assert.equal(snapshot.diagnostics.rejected.length, 1);
    assert.equal(snapshot.summary.totalTokens, 24);
    assert.equal(snapshot.summary.requestCount, 1);
    assert.equal(snapshot.summary.sessionCount, 1);
    assert.equal(snapshot.summary.engagedSeconds, 60);
    assert.equal(snapshot.summary.coverage.reasoningEffortBuckets, 1);
    assert.equal(snapshot.sourceSummaries['kimi-code'].totalTokens, 24);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('doctor report strips row-level and filesystem-private facts', async () => {
  const snapshot = await collectLocalSnapshot({
    sessionSalt: 'local-snapshot-test-salt'.padEnd(32, 'x'),
    sourceEntries: sourceEntries(),
    generatedAt: new Date('2026-08-10T12:00:00.000Z'),
  });
  const serialized = JSON.stringify(publicDoctorReport(snapshot));
  for (const secret of [
    '/Users/secret',
    'private-project',
    'kimi-code/k3',
    'a'.repeat(64),
    bucketStart,
  ]) assert.equal(serialized.includes(secret), false, `doctor report leaked ${secret}`);
  assert.equal(serialized.includes('fixture parser failure'), true);
});

test('local metric contract keeps token categories exclusive and price-independent', () => {
  const bucket = validBucket();
  assert.equal(observedTokenTotal(bucket), 24);
  const summary = summarizeUsage({ buckets: [bucket], sessions: [] });
  assert.equal(summary.inputTokens, 10);
  assert.equal(summary.cacheWriteInputTokens, 2);
  assert.equal(summary.cacheReadInputTokens, 3);
  assert.equal(summary.outputTokens, 4);
  assert.equal(summary.reasoningOutputTokens, 5);
  assert.equal('estimatedCost' in summary, false);
});

test('local metric activity range handles large histories without argument spreading', () => {
  const bucket = validBucket();
  const buckets = Array(150_000).fill(bucket);
  const summary = summarizeUsage({ buckets, sessions: [] });
  assert.equal(summary.bucketCount, 150_000);
  assert.equal(summary.firstActivityAt, bucket.bucketStart);
  assert.equal(
    summary.lastActivityAt,
    new Date(Date.parse(bucket.bucketStart) + 30 * 60 * 1000).toISOString(),
  );
});

test('snapshot module has no network-client dependency', () => {
  const source = readFileSync(new URL('../src/local/snapshot.js', import.meta.url), 'utf8');
  assert.equal(/from\s+['"]\.\.\/api\.js['"]/.test(source), false);
  assert.equal(source.includes('node:http'), false);
  assert.equal(source.includes('fetch('), false);
});
