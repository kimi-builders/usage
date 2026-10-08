import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fetchJetBrainsLimits, parseJetBrainsQuota } from '../src/limits/providers/jetbrains.js';
import { JETBRAINS_LOG_TAIL_BYTES, jetBrainsLogPath, parseJetBrainsLog, readJetBrainsLog } from '../src/limits/providers/jetbrains-log.js';
import { assertProviderContract } from '../src/limits/contract.js';

const root = mkdtempSync(join(tmpdir(), 'kbu-jetbrains-'));
after(() => rmSync(root, { recursive: true, force: true }));
const until = '2026-11-01T00:00:00Z';
const quota = { type: 'Available', current: '346000', maximum: '6489986.397',
  tariffQuota: { current: '346000', maximum: '1000000', available: '654000' } };
function xml(value = quota) {
  return `<application><component name="AIAssistantQuotaManager2"><option name="quotaInfo" value="${JSON.stringify(value).replaceAll('"', '&quot;')}"/></component></application>`;
}
const log = `2026-10-08 12:00:00,000 INFO - QuotaManager2Impl - New quota state is: Available(current=346000, maximum=6489986.397, until=${until}, tariffQuota=QuotaDetails(current=346000, maximum=1000000, available=654000), topUpQuota=QuotaDetails(current=0, maximum=5489986.397, available=5489986.397))\n`;
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }

test('JetBrains monthly quota uses a consistent pair, not the top-up total denominator', () => {
  const result = assertProviderContract('jetbrains-ai', parseJetBrainsQuota(xml()));
  assert.ok(Math.abs(result.windows[0].usedPercent - 34.6) < 1e-9);
  assert.ok(Math.abs(result.windows[0].remainingPercent - 65.4) < 1e-9);
  assert.equal(result.windows[0].limit, 1_000_000);
  assert.equal(result.windows[0].windowSeconds, null);
});

test('incomplete monthly counters fall back to total counters without borrowing monthly remaining', () => {
  for (const tariffQuota of [{ available: 9 }, { current: null, maximum: 100 }, { current: 1 }, { current: 'bad', maximum: 100 }]) {
    const window = parseJetBrainsQuota(xml({ current: 20, maximum: 200, tariffQuota })).windows[0];
    assert.equal(window.usedPercent, 10);
    assert.equal(window.remainingPercent, 90);
    assert.equal(window.limit, 200);
  }
  for (const value of [{}, { current: null, maximum: 100 }, { current: 0, maximum: 0 }]) {
    assert.throws(() => parseJetBrainsQuota(xml(value)), { code: 'invalid_response' });
  }
});

test('JetBrains log reader accepts complete finite records and fails closed on the newest invalid state', () => {
  assert.equal(parseJetBrainsLog(log).quota.tariffQuota.current, 346000);
  for (const invalid of [log.trimEnd(), log.replace('346000', '346..000'), log.replace('maximum=1000000', 'maximum=1e999'), log.replace('2026-10-08', '2026-02-30'), log.replace('Available(', 'Unknown(')]) {
    assert.equal(parseJetBrainsLog(log + invalid), null);
  }
  const withRefill = `${log}2026-10-08 12:00:01,000 INFO - QuotaManager2Impl - New quota refill state is: Known(next=${until}, tariff=QuotaRefillInfoTariff(amount=1000000, duration=monthly))\n`;
  assert.equal(parseJetBrainsLog(withRefill).refill.next, until);
});

test('JetBrains only pairs installed configuration with the same IDE log, including platform paths', () => {
  const home = join(root, 'paths');
  const macBase = join(home, 'Library', 'Application Support', 'JetBrains', 'WebStorm2026.2');
  assert.equal(jetBrainsLogPath(macBase, { home, platform: 'darwin' }), join(home, 'Library', 'Logs', 'JetBrains', 'WebStorm2026.2', 'idea.log'));
  assert.equal(jetBrainsLogPath(join(home, 'copies', 'JetBrains', 'WebStorm2026.2'), { home, platform: 'darwin' }), null);
  assert.equal(jetBrainsLogPath(join(home, '.config', 'Google', 'AndroidStudio2026'), { home, platform: 'linux' }), join(home, '.cache', 'Google', 'AndroidStudio2026', 'log', 'idea.log'));
  const environment = { APPDATA: join(home, 'roaming'), LOCALAPPDATA: join(home, 'local') };
  assert.equal(jetBrainsLogPath(join(environment.APPDATA, 'JetBrains', 'Rider2026'), { home, platform: 'win32', environment }), join(environment.LOCALAPPDATA, 'JetBrains', 'Rider2026', 'log', 'idea.log'));
});

test('bounded log tail discards a partial first line, rejects a partial final line, and keeps no raw logs', () => {
  const path = join(root, 'tail', 'idea.log');
  write(path, 'x'.repeat(JETBRAINS_LOG_TAIL_BYTES + 10) + '\n' + log);
  assert.equal(readJetBrainsLog(path).quota.tariffQuota.current, 346000);
  write(path, log + 'unfinished');
  assert.equal(readJetBrainsLog(path), null);
  assert.equal(readJetBrainsLog(join(root, 'missing')), null);
});

test('newer same-IDE log replaces stale XML; older, malformed or unrelated logs do not', async () => {
  const home = join(root, 'freshness');
  const options = { home, platform: 'darwin', environment: {} };
  const base = join(home, 'Library', 'Application Support', 'JetBrains', 'WebStorm2026.2');
  const path = join(base, 'options', 'AIAssistantQuotaManager2.xml');
  const logPath = jetBrainsLogPath(base, options);
  const old = new Date(2026, 9, 7, 12);
  const newer = new Date(2026, 9, 9, 12);
  write(path, xml({ current: 1, maximum: 100 }));
  write(logPath, log);
  utimesSync(path, old, old);
  const latest = await fetchJetBrainsLimits({ settings: {}, ...options });
  assert.ok(Math.abs(latest.windows[0].usedPercent - 34.6) < 1e-9);
  assert.equal(latest.updatedAt, new Date(2026, 9, 8, 12).toISOString());
  assert.equal(latest.windows[0].resetsAt, '2026-11-01T00:00:00.000Z');
  utimesSync(path, newer, newer);
  assert.equal((await fetchJetBrainsLimits({ settings: {}, ...options })).windows[0].usedPercent, 1);
  utimesSync(path, old, old);
  write(logPath, log + 'incomplete');
  assert.equal((await fetchJetBrainsLimits({ settings: {}, ...options })).windows[0].usedPercent, 1);
  const copied = join(home, 'copied', 'WebStorm2026.2');
  write(join(copied, 'options', 'AIAssistantQuotaManager2.xml'), xml({ current: 2, maximum: 100 }));
  write(logPath, log);
  assert.equal((await fetchJetBrainsLimits({ settings: { customPath: copied }, ...options })).windows[0].usedPercent, 2);
});

test('same-installation log can supply quota with no XML and does not borrow another IDE refill', async () => {
  const home = join(root, 'log-only');
  const options = { home, platform: 'linux', environment: {} };
  const base = join(home, '.config', 'JetBrains', 'PyCharm2026.2');
  mkdirSync(base, { recursive: true });
  write(jetBrainsLogPath(base, options), log);
  const result = await fetchJetBrainsLimits({ settings: {}, ...options });
  assert.ok(Math.abs(result.windows[0].usedPercent - 34.6) < 1e-9);
  assert.equal(result.source, 'PyCharm 2026.2');
});
