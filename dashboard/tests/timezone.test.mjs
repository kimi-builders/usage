import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const analyticsUrl = new URL('../src/analytics.js', import.meta.url).href;

test('local calendar streaks remain consecutive across daylight-saving changes', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { analyze } from ${JSON.stringify(analyticsUrl)};
    const makeBucket = (id, bucketStart) => ({
      id, source: 'codex', model: 'gpt', modelCanonical: 'gpt', bucketStart,
      inputTokens: 1, cacheWriteInputTokens: 0, cacheReadInputTokens: 0,
      outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 1,
      requestCount: 1, costMicros: 0, pricedTokens: 1, unpricedTokens: 0, assumedTokens: 0,
    });
    const report = analyze({
      generatedAt: '2026-03-09T19:00:00.000Z',
      device: { terminal: { name: 'Terminal' }, os: { name: 'macOS' } },
      buckets: [
        makeBucket(1, '2026-03-07T20:00:00.000Z'),
        makeBucket(2, '2026-03-08T19:00:00.000Z'),
        makeBucket(3, '2026-03-09T19:00:00.000Z'),
      ],
      sessions: [], activityHours: [],
    }, { range: 'all' });
    assert.deepEqual(report.streaks, { current: 3, longest: 3 });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Los_Angeles' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('rolling 24H keeps 24 elapsed-hour slots across spring-forward with local labels', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { analyze } from ${JSON.stringify(analyticsUrl)};
    const report = analyze({
      generatedAt: '2026-03-08T19:30:00.000Z',
      device: { terminal: { name: 'Terminal' }, os: { name: 'macOS' } },
      buckets: [], sessions: [], activityHours: [],
    }, { range: '24h' });
    assert.equal(report.series.length, 24);
    assert.equal(report.series[0].label, '03-07 12:00');
    assert.equal(report.series.at(-1).label, '03-08 12:00');
    assert.equal(report.series.some((slot) => slot.label === '03-08 02:00'), false);
    for (let index = 1; index < report.series.length; index += 1) {
      assert.equal(Date.parse(report.series[index].key) - Date.parse(report.series[index - 1].key), 3_600_000);
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Los_Angeles' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
