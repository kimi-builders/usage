import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const parserUrl = new URL('../src/parsers/index.js', import.meta.url).href;

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
