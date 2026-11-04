import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const JETBRAINS_LOG_TAIL_BYTES = 4 * 1024 * 1024;
const QUOTA_MARKER = 'QuotaManager2Impl - New quota state is: ';
const REFILL_MARKER = 'QuotaManager2Impl - New quota refill state is: ';
const JUNIE_MARKER = 'AiaActivationTransmitter - Received message from junie: quota_update:';
const DISABLED_ASSISTANT = 'Error(exception=com.intellij.ml.llm.core.AIAssistantForbiddenException';
const NUMBER = '([0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)';
const DETAILS = `QuotaDetails\\(current=${NUMBER}, maximum=${NUMBER}, available=${NUMBER}\\)`;
const QUOTA = new RegExp(`^Available\\(current=${NUMBER}, maximum=${NUMBER}, until=([^,)\\s]+), tariffQuota=${DETAILS}(?:, topUpQuota=${DETAILS})?\\)$`);
const REFILL = new RegExp(`^Known\\(next=([^,)\\s]+), tariff=QuotaRefillInfoTariff\\(amount=${NUMBER}, duration=([^,)\\s]+)\\)\\)$`);
const JBAI_DETAILS = DETAILS.replace('QuotaDetails', 'Details');
const JBAI_QUOTA = new RegExp(`^Available\\(quota=JbaiQuota\\(license=[^,()]*, current=${NUMBER}, maximum=${NUMBER}, quotaID=JbaiQuotaId\\([^()]*\\), until=([^,)\\s]+), tariffQuota=${JBAI_DETAILS}(?:, topUpQuota=${JBAI_DETAILS})?\\)\\)$`);
const JBAI_REFILL = new RegExp(`^Known\\(refill=JbaiQuotaRefill\\(tariff=JbaiQuotaTariff\\(amount=${NUMBER}, period=([^,)\\s]+)\\), next=([^,)\\s]+), last=[^,)\\s]+\\)\\)$`);

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
    // Air disables the assistant, but this message does not change account
    // identity. All other unknown/newest quota states still fail closed.
    if (line.includes(QUOTA_MARKER + DISABLED_ASSISTANT)) continue;
    if (line.includes(JUNIE_MARKER)) {
      const timestamp = localTimestamp(line);
      let value;
      try { value = JSON.parse(line.slice(line.indexOf(JUNIE_MARKER) + JUNIE_MARKER.length)); } catch { return null; }
      const amount = key => {
        const raw = value?.tariffQuota?.[key]?.amount;
        return typeof raw === 'number' || typeof raw === 'string' && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) ? Number(raw) : NaN;
      };
      const [current, maximum, available] = ['current', 'maximum', 'available'].map(amount);
      if (!timestamp || ![current, maximum, available].every(n => Number.isFinite(n) && n >= 0) || maximum <= 0
        || typeof value.until !== 'number' || !Number.isFinite(value.until)
        || value.until < Date.UTC(2020, 0, 1) || value.until > Date.UTC(2100, 0, 1)) return null;
      return { timestamp, quota: { type: 'Available', tariffQuota: { current, maximum }, until: new Date(value.until).toISOString() },
        refill: refill && refill.timestamp >= timestamp ? { next: refill.next } : null };
    }
    if (line.includes(QUOTA_MARKER)) {
      const timestamp = localTimestamp(line);
      const state = line.slice(line.indexOf(QUOTA_MARKER) + QUOTA_MARKER.length);
      const fields = QUOTA.exec(state) || JBAI_QUOTA.exec(state);
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
      const state = line.slice(line.indexOf(REFILL_MARKER) + REFILL_MARKER.length);
      const jbai = JBAI_REFILL.exec(state);
      const fields = REFILL.exec(state) || (jbai && [jbai[0], jbai[3], jbai[1], jbai[2]]);
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
