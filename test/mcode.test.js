import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, resolveMcodeDbPath } from '../src/parsers/mcode.js';

const SCHEMA = `CREATE TABLE local_runtime_sessions (
 session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT);
CREATE TABLE local_runtime_token_usage (
 id INTEGER PRIMARY KEY, session_id TEXT, model TEXT, ts INTEGER,
 input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
 cache_read_tokens INTEGER, cache_write_tokens INTEGER);`;

test('MiniMax Code reads only token ledger fields with exclusive cache accounting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-mcode-'));
  const path = join(directory, 'runtime-state.sqlite');
  execFileSync('sqlite3', [path, `${SCHEMA}
    INSERT INTO local_runtime_sessions VALUES ('s1','/tmp/session','/work/project-a');
    INSERT INTO local_runtime_token_usage VALUES (1,'s1','MiniMax-M3',1787935277463,10,9,3,4,5);`]);
  const previous = process.env.KBU_USAGE_MCODE_DB;
  process.env.KBU_USAGE_MCODE_DB = path;
  try {
    const result = await parse();
    assert.deepEqual(result.buckets[0], {
      source: 'mcode', model: 'MiniMax-M3', project: 'project-a',
      bucketStart: '2026-08-28T16:30:00.000Z', inputTokens: 10,
      cacheWriteInputTokens: 5, cacheReadInputTokens: 4, outputTokens: 9,
      reasoningOutputTokens: 3, requestCount: 1, measurement: 'exact',
    });
    assert.equal(JSON.stringify(result).includes('/work/'), false);
  } finally {
    if (previous === undefined) delete process.env.KBU_USAGE_MCODE_DB;
    else process.env.KBU_USAGE_MCODE_DB = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('MiniMax Code path precedence validates MCODE_HOME', () => {
  assert.equal(resolveMcodeDbPath({ KBU_USAGE_MCODE_DB: '/tmp/mcode.sqlite' }), '/tmp/mcode.sqlite');
  assert.throws(() => resolveMcodeDbPath({ MCODE_HOME: 'relative' }), /absolute/);
});
