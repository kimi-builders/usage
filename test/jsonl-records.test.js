import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonlRecords } from '../src/parsers/jsonl-records.js';

test('bounded JSONL reading skips oversized and corrupt lines without exposing content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-jsonl-'));
  try {
    const path = join(directory, 'session.jsonl');
    writeFileSync(path, [JSON.stringify({ content: 'PRIVATE'.repeat(12000) }), '{"id":"中文"}', 'null', '{bad}', '{"id":2}'].join('\n'));
    const warnings = [];
    const records = [];
    for await (const record of jsonlRecords(path, (warning) => warnings.push(warning), { maxLineBytes: 32 })) records.push(record);
    assert.deepEqual(records, [{ id: '中文' }, { id: 2 }]);
    assert.equal(warnings.length, 3);
    assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE|bad|session.jsonl/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
