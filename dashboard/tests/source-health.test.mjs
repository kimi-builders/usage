import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceHasIssue, summarizeSourceHealth } from '../src/source-health.js';

test('source health treats missing local data as neutral and isolates real parser issues', () => {
  const sources = [
    { status: 'ok' },
    { status: 'skipped' },
    { status: 'partial' },
    { status: 'failed' },
  ];
  const summary = summarizeSourceHealth(sources);
  assert.equal(summary.healthyCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.deepEqual(summary.issueSources, [sources[2], sources[3]]);
  assert.equal(sourceHasIssue(sources[0]), false);
  assert.equal(sourceHasIssue(sources[1]), false);
  const warnedSource = { status: 'ok', warningCount: 1 };
  assert.equal(sourceHasIssue(warnedSource), true);

  const warnedSummary = summarizeSourceHealth([warnedSource]);
  assert.equal(warnedSummary.healthyCount, 0);
  assert.deepEqual(warnedSummary.issueSources, [warnedSource]);
});
