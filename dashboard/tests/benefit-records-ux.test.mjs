import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('benefit observation log paginates the complete selected record set', async () => {
  const jsx = await read('../src/SubscriptionAnalytics.jsx');
  assert.doesNotMatch(jsx, /\.slice\(0,\s*100\)/);
  assert.match(jsx, /const rows = allQuotaRows;/);
  assert.match(jsx, /const usageRows = dayUsageRows\.map/);
  assert.match(jsx, /Math\.ceil\(total \/ RECORD_PAGE_SIZE\)/);
  assert.match(jsx, /pageRows = activeRows\.slice\(rowOffset, rowOffset \+ RECORD_PAGE_SIZE\)/);
});

test('benefit observation log labels totals and exposes full table position', async () => {
  const jsx = await read('../src/SubscriptionAnalytics.jsx');
  assert.match(jsx, /`共 \$\{total\.toLocaleString\(\)\} 条`/);
  assert.match(jsx, /aria-rowcount=\{totalRows \+ 1\}/);
  assert.match(jsx, /aria-rowindex=\{rowOffset \+ index \+ 2\}/);
  assert.match(jsx, /显示 \$\{rowOffset \+ \(pageRows\.length \? 1 : 0\)\}–\$\{rowOffset \+ pageRows\.length\}，共 \$\{total\.toLocaleString\(\)\} 条/);
});
