import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addLocalWeeks,
  firstDataWeekStart,
  isoWeekNumber,
  localWeekEnd,
  localWeekStart,
  weekLabel,
} from '../src/week.js';

test('localWeekStart snaps to Monday 00:00 local and is idempotent', () => {
  const wednesday = new Date(2026, 7, 12, 18, 40);
  const monday = localWeekStart(wednesday);
  assert.equal(monday.getDay(), 1);
  assert.equal(monday.getHours(), 0);
  assert.equal(monday.getMinutes(), 0);
  assert.equal(monday.getDate(), 10);
  assert.equal(localWeekStart(monday).getTime(), monday.getTime());
  // Sunday belongs to the week that started the previous Monday.
  const sunday = localWeekStart(new Date(2026, 7, 16, 9));
  assert.equal(sunday.getTime(), monday.getTime());
});

test('week end is the next Monday; addLocalWeeks moves by whole weeks', () => {
  const monday = localWeekStart(new Date(2026, 7, 12));
  assert.equal(localWeekEnd(monday).getDate(), 17);
  assert.equal(addLocalWeeks(monday, -1).getDate(), 3);
});

test('isoWeekNumber matches known ISO weeks across year boundaries', () => {
  // 2026-01-01 is a Thursday, so ISO week 1 of 2026 starts Monday 2025-12-29.
  assert.equal(isoWeekNumber(new Date(2025, 11, 29)), 1);
  assert.equal(isoWeekNumber(new Date(2026, 0, 4)), 1);
  assert.equal(isoWeekNumber(new Date(2026, 7, 10)), 33);
  // 2025-12-29..31 are still ISO 2026-W01; 2025-01-01 is ISO 2025-W01.
  assert.equal(isoWeekNumber(new Date(2025, 0, 1)), 1);
  assert.equal(isoWeekNumber(new Date(2024, 11, 30)), 1);
});

test('weekLabel renders compact zh/en ranges within and across months', () => {
  assert.equal(weekLabel(new Date(2026, 7, 10), true), '第 33 周 · 8月10日–16日');
  assert.equal(weekLabel(new Date(2026, 7, 10), false), 'Week 33 · Aug 10–16');
  assert.equal(weekLabel(new Date(2026, 6, 27), true), '第 31 周 · 7月27日–8月2日');
  assert.equal(weekLabel(new Date(2026, 6, 27), false), 'Week 31 · Jul 27–Aug 2');
});

test('firstDataWeekStart finds the earliest week and tolerates junk', () => {
  const start = firstDataWeekStart(['not-a-date', new Date(2026, 7, 12, 9).toISOString(), new Date(2026, 5, 3, 9).toISOString()]);
  assert.equal(start.getDate(), 1);
  assert.equal(start.getMonth(), 5);
  assert.equal(firstDataWeekStart([]), null);
});
