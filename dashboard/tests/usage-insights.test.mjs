import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeBudget,
  analyzeMilestones,
  analyzeSpikes,
  budgetSignature,
  localDateKey,
  milestoneSignature,
  percentile95,
  spikeSignature,
} from '../src/usage-insights.js';

function localTime(day, hour = 12, minute = 0, month = 7) {
  return new Date(2026, month, day, hour, minute, 0, 0);
}

function bucket(day, hour, totalTokens, extra = {}) {
  return {
    bucketStart: localTime(day, hour).toISOString(),
    totalTokens,
    inputTokens: totalTokens,
    costMicros: totalTokens,
    ...extra,
  };
}

function baseline(days = 7, totalTokens = 100_000) {
  return Array.from({ length: days }, (_, index) => bucket(index + 1, 9, totalTokens));
}

test('P95 uses the nearest-rank value and handles no data', () => {
  assert.equal(percentile95(Array.from({ length: 100 }, (_, index) => index + 1)), 95);
  assert.equal(percentile95([]), 0);
});

test('budget stays a user target, hides noisy early projection, and signs by month and value', () => {
  const early = analyzeBudget({ buckets: [bucket(2, 12, 20)] }, { metric: 'tokens', target: 100 }, localTime(3, 0));
  assert.equal(early.configured, true);
  assert.equal(early.current, 20);
  assert.equal(early.mayProject, false);
  assert.equal(early.projected, null);
  assert.match(budgetSignature({ metric: 'tokens', target: 100 }, localTime(3)), /^2026-08:tokens:100$/);
  assert.notEqual(
    budgetSignature({ metric: 'tokens', target: 100 }, localTime(3)),
    budgetSignature({ metric: 'tokens', target: 101 }, localTime(3)),
  );
});

test('budget forecasts an in-month hit only after three elapsed days', () => {
  const rows = Array.from({ length: 5 }, (_, index) => bucket(index + 1, 12, 100));
  const result = analyzeBudget({ buckets: rows }, { metric: 'tokens', target: 1_000 }, localTime(6, 0));
  assert.equal(result.mayProject, true);
  assert.ok(result.projected > result.target);
  assert.equal(result.hitDate.getDate(), 10);
  assert.equal(result.overPace, true);
});

test('spike detection waits for seven distinct complete local days', () => {
  const result = analyzeSpikes({ buckets: [...baseline(6), bucket(12, 10, 9_000_000)], sessions: [] }, localTime(12, 18));
  assert.equal(result.status, 'building');
  assert.equal(result.sampleDays, 6);
  assert.deepEqual(result.hourly, []);
});

test('hourly spike uses the 1M floor and attributes the dominant source and project', () => {
  const result = analyzeSpikes({
    buckets: [
      ...baseline(),
      bucket(12, 10, 900_001, { source: 'codex', project: 'site' }),
      bucket(12, 10, 100_000, { source: 'kimi-code', project: 'cli' }),
    ],
    sessions: [],
  }, localTime(12, 18));
  assert.equal(result.status, 'ready');
  assert.equal(result.hourlyP95, 100_000);
  assert.equal(result.hourlyThreshold, 1_000_000);
  assert.equal(result.hourly.length, 1);
  assert.equal(result.hourly[0].source, 'codex');
  assert.equal(result.hourly[0].project, 'site');
  assert.equal(result.hourly[0].signature, `hour:${localDateKey(localTime(12))}:10`);
});

test('local day and hour boundaries do not follow UTC date boundaries', () => {
  const latePreviousDay = { ...bucket(11, 23, 100_000), bucketStart: localTime(11, 23, 30).toISOString() };
  const earlyToday = { ...bucket(12, 0, 1_000_001), bucketStart: localTime(12, 0, 30).toISOString() };
  const result = analyzeSpikes({ buckets: [...baseline(), latePreviousDay, earlyToday], sessions: [] }, localTime(12, 1));
  assert.equal(result.hourly.length, 1);
  assert.equal(result.hourly[0].dateKey, localDateKey(localTime(12)));
  assert.equal(result.hourly[0].hour, 0);
});

test('session spikes use a separate 5M floor and stable signature', () => {
  const sessions = baseline().map((row, index) => ({
    id: `old-${index}`,
    source: 'codex',
    lastMessageAt: row.bucketStart,
    totalTokens: 1_000_000,
  }));
  sessions.push({ id: 'runaway', source: 'claude-code', project: 'app', lastMessageAt: localTime(12, 11).toISOString(), totalTokens: 5_000_001 });
  const result = analyzeSpikes({ buckets: baseline(), sessions }, localTime(12, 18));
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].threshold, 5_000_000);
  assert.equal(result.sessions[0].signature, spikeSignature(result.sessions[0]));
});

test('session detection does not invent a baseline when historical session totals are absent', () => {
  const result = analyzeSpikes({
    buckets: baseline(),
    sessions: [{ id: 'new-schema-only', source: 'codex', lastMessageAt: localTime(12, 11).toISOString(), totalTokens: 9_000_000 }],
  }, localTime(12, 18));
  assert.deepEqual(result.sessions, []);
});

test('spike detection is quiet for an empty history and signatures deduplicate an hour', () => {
  assert.equal(analyzeSpikes({ buckets: [], sessions: [] }, localTime(12)).status, 'building');
  const row = { kind: 'hour', dateKey: '2026-08-12', hour: 9 };
  assert.equal(spikeSignature(row), spikeSignature({ ...row, totalTokens: 99_000_000 }));
});

test('streak includes today when active and starts at yesterday when today is empty', () => {
  const active = analyzeMilestones({ buckets: [bucket(10, 8, 10), bucket(11, 8, 10), bucket(12, 8, 10)] }, localTime(12, 18));
  assert.equal(active.streak, 3);
  const inactiveToday = analyzeMilestones({ buckets: [bucket(9, 8, 10), bucket(10, 8, 10), bucket(11, 8, 10)] }, localTime(12, 18));
  assert.equal(inactiveToday.streak, 3);
  const gap = analyzeMilestones({ buckets: [bucket(9, 8, 10), bucket(11, 8, 10)] }, localTime(12, 18));
  assert.equal(gap.streak, 1);
});

test('exact milestone crossing celebrates once and exposes next-target progress', () => {
  const data = { buckets: [bucket(11, 8, 600_000_000), bucket(12, 8, 400_000_000)] };
  const first = analyzeMilestones(data, localTime(12, 18));
  assert.deepEqual(first.achieved, [1_000_000_000]);
  assert.equal(first.nextMilestone, 5_000_000_000);
  assert.equal(first.celebrations[0].signature, milestoneSignature(1_000_000_000));
  const seen = analyzeMilestones(data, localTime(12, 18), [milestoneSignature(1_000_000_000)]);
  assert.deepEqual(seen.celebrations, []);
});

test('an old milestone crossing is retained but not celebrated again', () => {
  const result = analyzeMilestones({ buckets: [bucket(1, 8, 1_000_000_000)] }, localTime(20, 18));
  assert.deepEqual(result.achieved, [1_000_000_000]);
  assert.deepEqual(result.celebrations, []);
  assert.equal(result.peakDay.key, localDateKey(localTime(1)));
});
