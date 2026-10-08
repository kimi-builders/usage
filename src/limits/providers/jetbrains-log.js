import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const JETBRAINS_LOG_TAIL_BYTES = 4 * 1024 * 1024;
const QUOTA_MARKER = 'QuotaManager2Impl - New quota state is: ';
const REFILL_MARKER = 'QuotaManager2Impl - New quota refill state is: ';
const NUMBER = '([0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)';
const DETAILS = `QuotaDetails\\(current=${NUMBER}, maximum=${NUMBER}, available=${NUMBER}\\)`;
const QUOTA = new RegExp(`^Available\\(current=${NUMBER}, maximum=${NUMBER}, until=([^,)\\s]+), tariffQuota=${DETAILS}(?:, topUpQuota=${DETAILS})?\\)$`);
const REFILL = new RegExp(`^Known\\(next=([^,)\\s]+), tariff=QuotaRefillInfoTariff\\(amount=${NUMBER}, duration=([^,)\\s]+)\\)\\)$`);

export function jetBrainsConfigRoots({ platform = process.platform, home = homedir(), environment = process.env } = {}) {
  const parents = platform === 'darwin' ? [join(home, 'Library', 'Application Support')]
    : platform === 'win32' ? [environment.APPDATA || join(home, 'AppData', 'Roaming')]
      : [join(home, '.config'), join(home, '.local', 'share')];
  return parents.flatMap((parent) => ['JetBrains', 'Google'].map((vendor) => join(parent, vendor)));
}

export function jetBrainsLogPath(basePath, options = {}) {
  const { platform = process.platform, home = homedir(), environment = process.env } = options;
  const base = resolve(basePath);
  const parent = dirname(base);
  // A copied/custom configuration does not prove ownership of an installed
  // IDE's log. Never pair solely by the IDE version / directory name.
  if (!jetBrainsConfigRoots(options).some((root) => resolve(root) === parent)) return null;
  const vendor = basename(parent);
  if (platform === 'darwin') return join(home, 'Library', 'Logs', vendor, basename(base), 'idea.log');
  const root = platform === 'win32'
    ? environment.LOCALAPPDATA || join(home, 'AppData', 'Local')
    : join(home, '.cache');
  return join(root, vendor, basename(base), 'log', 'idea.log');
}

function localTimestamp(line) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}),(\d{3})/.exec(line);
  if (!match) return null;
  const [year, month, day, hour, minute, second, ms] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second, ms);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second
    ? date : null;
}

export function parseJetBrainsLog(content) {
  if (!content.endsWith('\n')) return null;
  let refill = null;
  let foundRefill = false;
  for (const line of content.split(/\r?\n/).reverse()) {
    if (line.includes(QUOTA_MARKER)) {
      const timestamp = localTimestamp(line);
      const fields = QUOTA.exec(line.slice(line.indexOf(QUOTA_MARKER) + QUOTA_MARKER.length));
      // A malformed/unknown newest state invalidates the log, rather than
      // resurrecting an older quota (possibly belonging to another account).
      if (!timestamp || !fields || !Number.isFinite(Date.parse(fields[3]))) return null;
      const values = fields.slice(1).filter((_, index) => index !== 2).filter((value) => value != null).map(Number);
      if (!values.every((value) => Number.isFinite(value) && value >= 0) || values[3] <= 0) return null;
      return {
        timestamp,
        quota: { type: 'Available', tariffQuota: { current: values[2], maximum: values[3] }, until: fields[3] },
        // Only use a refill from this quota record onward. Never borrow XML
        // or a refill preceding the newest quota/account boundary.
        refill: refill && refill.timestamp >= timestamp ? { next: refill.next } : null,
      };
    }
    if (!foundRefill && line.includes(REFILL_MARKER)) {
      foundRefill = true;
      const fields = REFILL.exec(line.slice(line.indexOf(REFILL_MARKER) + REFILL_MARKER.length));
      const timestamp = localTimestamp(line);
      if (timestamp && fields && Number.isFinite(Date.parse(fields[1])) && Number.isFinite(Number(fields[2]))) {
        refill = { timestamp, next: fields[1] };
      }
    }
  }
  return null;
}

export function readJetBrainsLog(path) {
  if (!path) return null;
  let fd;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || !stat.size) return null;
    // Capture EOF once: a live writer cannot extend this bounded read.
    const size = Math.min(stat.size, JETBRAINS_LOG_TAIL_BYTES);
    const offset = stat.size - size;
    const bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const count = readSync(fd, bytes, read, size - read, offset + read);
      if (!count) return null; // truncated/rotated during the read
      read += count;
    }
    const start = offset ? bytes.indexOf(10) + 1 : 0;
    if (offset && start === 0) return null;
    return parseJetBrainsLog(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start)));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
