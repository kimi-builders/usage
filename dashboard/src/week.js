/* Local natural weeks (Monday 00:00 → next Monday 00:00) and ISO-8601 week
   numbers for the heatmap week pager. All helpers take/return local Dates;
   callers filter facts by [start, end). */

export function localWeekStart(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

export function addLocalWeeks(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount * 7);
  return date;
}

export function localWeekEnd(value) {
  return addLocalWeeks(localWeekStart(value), 1);
}

export function isoWeekNumber(value) {
  const monday = localWeekStart(value);
  const thursday = new Date(monday);
  thursday.setDate(thursday.getDate() + 3);
  // Jan 4 is always in ISO week 1; round() absorbs any DST hour shift.
  const week1Monday = localWeekStart(new Date(thursday.getFullYear(), 0, 4));
  return Math.round((monday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekLabel(start, zh) {
  const monday = localWeekStart(start);
  const sunday = addLocalWeeks(monday, 1);
  sunday.setDate(sunday.getDate() - 1);
  const week = isoWeekNumber(monday);
  const month = monday.getMonth() + 1;
  const day = monday.getDate();
  const endMonth = sunday.getMonth() + 1;
  const endDay = sunday.getDate();
  if (zh) return `第 ${week} 周 · ${month}月${day}日–${endMonth === month ? '' : `${endMonth}月`}${endDay}日`;
  return `Week ${week} · ${EN_MONTHS[month - 1]} ${day}–${endMonth === month ? '' : `${EN_MONTHS[endMonth - 1]} `}${endDay}`;
}

/* Earliest week containing data, for the pager's lower bound. */
export function firstDataWeekStart(timestamps) {
  let earliest = Number.POSITIVE_INFINITY;
  for (const value of timestamps) {
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time < earliest) earliest = time;
  }
  return Number.isFinite(earliest) ? localWeekStart(earliest) : null;
}
