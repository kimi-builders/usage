import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsageCsv } from '../src/parsers/cursor.js';

test('Cursor CSV importer handles quoted fields and keeps token categories exclusive', () => {
  const entries = parseUsageCsv([
    'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens',
    '2026-08-01,"claude, sonnet","1,200",300,"4,000",50',
  ].join('\n'));

  assert.equal(entries.length, 1);
  assert.deepEqual(
    {
      model: entries[0].model,
      input: entries[0].inputTokens,
      cacheWrite: entries[0].cacheWriteInputTokens,
      cacheRead: entries[0].cacheReadInputTokens,
      output: entries[0].outputTokens,
    },
    { model: 'claude, sonnet', input: 300, cacheWrite: 1_200, cacheRead: 4_000, output: 50 },
  );
});
