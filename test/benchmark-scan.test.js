import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureScan } from '../scripts/benchmark-scan.mjs';
import { collectLocalSnapshot } from '../src/local/snapshot.js';

test('scan benchmark preserves source policy, performs full parsing, and emits only aggregate diagnostics', async () => {
  let parses = 0;
  const source = { id: 'codex', tier: 'stable', roots: () => ['/sensitive-path'], parse: async options => {
    parses++;
    assert.equal(options.includePerformance, true);
    return { skipped: true, buckets: [], sessions: [], warnings: ['private-content'], turnPerformance: [] };
  } };
  const result = await measureScan({ collectLocalSnapshot, sources: [source], config: { sourcePolicies: { codex: 'local' } } });
  assert.equal(parses, 1);
  assert.deepEqual(result.sources.map(({ source, status, warningCount }) => ({ source, status, warningCount })),
    [{ source: 'codex', status: 'partial', warningCount: 1 }]);
  assert.doesNotMatch(JSON.stringify(result), /sensitive|private-content/);
  assert.ok(result.peakRssMiB > 0);
  assert.ok(result.elapsedMs >= 0);
  const off = await measureScan({ collectLocalSnapshot, sources: [source], config: { sourcePolicies: { codex: 'off' } } });
  assert.equal(parses, 1);
  assert.deepEqual(off.sources, []);
});

test('benchmark CLI never scans implicitly, rejects invalid arguments, and explains comparison limits', () => {
  const path = fileURLToPath(new URL('../scripts/benchmark-scan.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [path], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Read-only/);
  assert.match(help.stdout, /系统文件缓存/);
  for (const args of [['--runs', '2'], ['--local', '--runs', '0'], ['--local', '--runs', '6'], ['--local', '--typo']]) {
    assert.equal(spawnSync(process.execPath, [path, ...args]).status, 1);
  }
});
