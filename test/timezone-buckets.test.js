import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const parserUrl = new URL('../src/parsers/index.js', import.meta.url).href;
const statsUrl = new URL('../src/stats.js', import.meta.url).href;

for (const timezone of ['Asia/Kathmandu', 'Pacific/Chatham']) {
  test(`bucket rounding stays on a UTC half-hour boundary in ${timezone}`, () => {
    const script = `
      const { roundToHalfHour } = await import(${JSON.stringify(parserUrl)});
      const value = roundToHalfHour(new Date('2026-08-10T04:15:00.000Z'));
      process.stdout.write(value.toISOString());
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timezone },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '2026-08-10T04:00:00.000Z');
  });
}

test('CLI calendar ranges and labels stay local across daylight-saving changes', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { formatDayKey, parsePeriod } from ${JSON.stringify(statsUrl)};
    const spring = parsePeriod('7d', new Date('2026-03-10T12:00:00-07:00'));
    assert.equal(new Date(spring.startMs).toString().startsWith('Wed Mar 04 2026 00:00:00'), true);
    const fall = parsePeriod('30d', new Date('2026-11-05T12:00:00-08:00'));
    assert.equal(new Date(fall.startMs).toString().startsWith('Wed Oct 07 2026 00:00:00'), true);
    const rolling = parsePeriod('24h', new Date('2026-03-08T12:00:00-07:00'));
    assert.equal(rolling.endMs - rolling.startMs, 86_400_000);
    assert.equal(formatDayKey('2026-08-19'), '08-19');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Los_Angeles' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
