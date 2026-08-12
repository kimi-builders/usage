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
