import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, parseUsageCsv } from '../src/parsers/cursor.js';

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

test('Cursor skips a renamed export header instead of uploading an empty snapshot', async () => {
  // Cursor renaming a column used to degrade into "zero tokens everywhere" —
  // an empty upload that also pruned the incremental state. The header check
  // must turn that into a skipped run with a warning.
  const home = mkdtempSync(join(tmpdir(), 'kbu-cursor-header-'));
  const csvPath = join(home, 'usage.csv');
  writeFileSync(csvPath, [
    'Date,Model,Kind,Input Tokens,Output',
    '2026-09-07T01:02:00Z,test-model,Included,10,20',
  ].join('\n'));
  const previous = process.env.KBU_USAGE_CURSOR_CSV;
  process.env.KBU_USAGE_CURSOR_CSV = csvPath;
  try {
    const result = await parse();
    assert.equal(result.skipped, true);
    assert.deepEqual(result.buckets, []);
    assert.deepEqual(result.sessions, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /export header does not match/);
    assert.match(result.warnings[0], /Current header: Date, Model, Kind/);
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_CURSOR_CSV; else process.env.KBU_USAGE_CURSOR_CSV = previous;
    rmSync(home, { recursive: true, force: true });
  }
});
