import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  compactLimitHistory, loadLimitHistory, normalizeLimitHistory, recordLimitSnapshot,
} from '../src/limits/history.js';

const NOW = Date.parse('2026-08-12T12:00:00.000Z');

function result(observedAt, usedPercent = 25) {
  return {
    generatedAt: observedAt,
    providers: [{
      id: 'codex', label: 'Codex', status: 'ok', account: 'private@example.com', source: '/private/path',
      updatedAt: observedAt,
      windows: [{
        id: 'primary', label: '5 小时', usedPercent, remainingPercent: 100 - usedPercent,
        resetsAt: '2026-08-12T15:00:00.000Z', windowSeconds: 18_000,
      }],
    }, {
      id: 'warp', label: 'Warp', status: 'error', error: { message: 'secret response' }, windows: [],
    }],
  };
}

test('records only sanitized provider quota facts in a separate private history file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-limit-history-'));
  const path = join(directory, 'history.json');
  try {
    const history = recordLimitSnapshot(result('2026-08-12T11:00:00.000Z'), { path, now: NOW });
    assert.equal(history.observations.length, 1);
    assert.deepEqual(history.observations[0].providers.map((provider) => provider.id), ['codex']);
    assert.deepEqual(Object.keys(history.observations[0].providers[0]), ['id', 'observedAt', 'windows']);
    assert.equal(history.observations[0].providers[0].observedAt, '2026-08-12T11:00:00.000Z');
    const raw = readFileSync(path, 'utf8');
    assert.equal(raw.includes('private@example.com'), false);
    assert.equal(raw.includes('/private/path'), false);
    assert.equal(raw.includes('secret response'), false);
    assert.equal(loadLimitHistory({ path, now: NOW }).observations[0].providers[0].windows[0].usedPercent, 25);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves missing quota values instead of fabricating zero usage', () => {
  const history = normalizeLimitHistory({ observations: [{
    observedAt: '2026-08-11T12:00:00.000Z',
    providers: [{ id: 'codex', status: 'ok', windows: [{
      id: 'primary', label: '5 hours', usedPercent: null, remainingPercent: '',
    }] }],
  }] }, { now: Date.parse('2026-08-11T12:00:00.000Z') });
  const window = history.observations[0].providers[0].windows[0];
  assert.equal(window.usedPercent, null);
  assert.equal(window.remainingPercent, null);
});

test('compacts recent snapshots to 15-minute buckets and older snapshots to daily points', () => {
  const observations = [
    result('2026-08-12T11:01:00.000Z', 10),
    result('2026-08-12T11:14:00.000Z', 12),
    result('2026-08-12T11:16:00.000Z', 14),
    result('2026-05-01T08:00:00.000Z', 40),
    result('2026-05-01T20:00:00.000Z', 60),
  ].map((snapshot) => ({ observedAt: snapshot.generatedAt, providers: snapshot.providers }));
  const compacted = compactLimitHistory(observations, { now: NOW });
  assert.deepEqual(compacted.map((item) => item.providers[0].windows[0].usedPercent), [60, 12, 14]);
});

test('merges alternating provider successes but replaces a re-observed provider window set', () => {
  const observations = [{
    observedAt: '2026-08-12T11:01:00.000Z',
    providers: [{ id: 'codex', status: 'ok', plan: 'must-not-persist', windows: [
      { id: 'primary', label: '5 hours', usedPercent: 10, remainingPercent: 90 },
      { id: 'weekly', label: 'Weekly', usedPercent: 20, remainingPercent: 80 },
    ] }],
  }, {
    observedAt: '2026-08-12T11:05:00.000Z',
    providers: [{ id: 'warp', status: 'ok', account: 'private@example.com', windows: [
      { id: 'monthly', label: 'Monthly', usedPercent: 30, remainingPercent: 70 },
    ] }],
  }, {
    observedAt: '2026-08-12T11:10:00.000Z',
    providers: [{ id: 'codex', status: 'ok', source: '/private/path', windows: [
      { id: 'primary', label: '5 hours', usedPercent: 40, remainingPercent: 60 },
    ] }, { id: 'warp', status: 'error', windows: [] }],
  }];
  const [bucket] = compactLimitHistory(observations, { now: NOW });
  assert.equal(bucket.observedAt, '2026-08-12T11:10:00.000Z');
  assert.deepEqual(bucket.providers.map((provider) => provider.id), ['codex', 'warp']);
  assert.deepEqual(
    bucket.providers.find((provider) => provider.id === 'codex').windows.map((window) => [window.id, window.usedPercent]),
    [['primary', 40]],
  );
  assert.equal(bucket.providers.find((provider) => provider.id === 'warp').windows[0].usedPercent, 30);
  assert.equal(bucket.providers.find((provider) => provider.id === 'codex').observedAt, '2026-08-12T11:10:00.000Z');
  assert.equal(bucket.providers.find((provider) => provider.id === 'warp').observedAt, '2026-08-12T11:05:00.000Z');
  assert.equal(JSON.stringify(bucket).includes('must-not-persist'), false);
  assert.equal(JSON.stringify(bucket).includes('private@example.com'), false);
  assert.equal(JSON.stringify(bucket).includes('/private/path'), false);
});

test('keeps each provider real observation time when partial successes share a compacted bucket', () => {
  const [bucket] = compactLimitHistory([{
    observedAt: '2026-08-12T11:01:00.000Z',
    providers: [{
      id: 'provider-a', observedAt: '2026-08-12T11:01:00.000Z', windows: [
        { id: 'hourly', label: 'Hourly', usedPercent: 10, remainingPercent: 90 },
      ],
    }],
  }, {
    observedAt: '2026-08-12T11:14:00.000Z',
    providers: [{
      id: 'provider-b', observedAt: '2026-08-12T11:14:00.000Z', windows: [
        { id: 'weekly', label: 'Weekly', usedPercent: 20, remainingPercent: 80 },
      ],
    }],
  }], { now: NOW });

  assert.equal(bucket.observedAt, '2026-08-12T11:14:00.000Z');
  assert.equal(bucket.providers.find((provider) => provider.id === 'provider-a').observedAt, '2026-08-12T11:01:00.000Z');
  assert.equal(bucket.providers.find((provider) => provider.id === 'provider-b').observedAt, '2026-08-12T11:14:00.000Z');
});

test('normalizes schema v1 history by preserving its real container time on each provider', () => {
  const history = normalizeLimitHistory({ schemaVersion: 1, observations: [{
    observedAt: '2026-08-12T10:04:00.000Z',
    providers: [{ id: 'codex', windows: [
      { id: 'primary', label: '5 hours', usedPercent: 10, remainingPercent: 90 },
    ] }],
  }] }, { now: NOW });

  assert.equal(history.schemaVersion, 1);
  assert.equal(history.observations[0].providers[0].observedAt, '2026-08-12T10:04:00.000Z');
});

test('does not treat an explicitly invalid provider time as legacy history', () => {
  const history = normalizeLimitHistory({ schemaVersion: 1, observations: [{
    observedAt: '2026-08-12T10:04:00.000Z',
    providers: [{ id: 'codex', observedAt: null, windows: [
      { id: 'primary', label: '5 hours', usedPercent: 10, remainingPercent: 90 },
    ] }],
  }] }, { now: NOW });

  assert.deepEqual(history.observations, []);
});

test('does not record a fresh provider with a missing or invalid observation time', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-limit-history-missing-time-'));
  const path = join(directory, 'history.json');
  try {
    const snapshot = result('2026-08-12T11:00:00.000Z');
    snapshot.providers[0].updatedAt = 'not-a-time';
    const history = recordLimitSnapshot(snapshot, { path, now: NOW });
    assert.deepEqual(history.observations, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed history fails closed to an empty schema', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-limit-history-invalid-'));
  const path = join(directory, 'history.json');
  try {
    recordLimitSnapshot(result('2026-08-12T11:00:00.000Z'), { path, now: NOW });
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    raw.observations.push({ observedAt: 'bad', providers: [{ id: 'codex', status: 'ok', windows: [] }] });
    assert.equal(compactLimitHistory(raw.observations, { now: NOW }).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
