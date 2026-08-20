import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const cliEntry = resolve(repoRoot, packageJson.bin['kbu-usage']);
const usageFixture = fileURLToPath(new URL('./fixtures/cli/cursor-usage.csv', import.meta.url));
const pricingFixture = JSON.parse(readFileSync(
  new URL('./fixtures/cli/pricing-contract.json', import.meta.url),
  'utf8',
));
const sourceIds = [
  'kimi-code',
  'claude-code',
  'codex',
  'opencode',
  'gemini-cli',
  'antigravity',
  'copilot-cli',
  'roo-code',
  'pi-coding-agent',
  'zcode',
  'workbuddy',
  'cursor',
];

function isolatedCli(t, { cursor = false, extraEnv = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kbu-cli-e2e-'));
  const home = join(root, 'home');
  const configDir = join(root, 'config');
  mkdirSync(home, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  const sourcePolicies = Object.fromEntries(sourceIds.map((source) => [source, 'off']));
  if (cursor) sourcePolicies.cursor = 'local';
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({
    sessionSalt: 'e'.repeat(64),
    sourcePolicyVersion: 1,
    sourcePolicies,
    enabledSources: cursor ? ['cursor'] : [],
    sourceOptions: cursor ? { cursor: { csvPath: usageFixture } } : {},
  }, null, 2)}\n`, { mode: 0o600 });
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    KBU_USAGE_CONFIG_DIR: configDir,
    NO_COLOR: '1',
    ...extraEnv,
  };
  return (args) => spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30_000,
  });
}

function assertSucceeded(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

test('package bin contract executes the real published CLI entry', (t) => {
  const runCli = isolatedCli(t);
  assert.equal(packageJson.bin['kbu-usage'], 'bin/kbu-usage.js');
  if (process.platform !== 'win32') assert.notEqual(statSync(cliEntry).mode & 0o111, 0);
  const stdout = assertSucceeded(runCli(['--version']));
  assert.equal(stdout.trim(), packageJson.version);
});

test('global flags work before or after the command and select the requested language', (t) => {
  const runCli = isolatedCli(t, { extraEnv: { KBU_USAGE_LANG: 'zh' } });
  const before = assertSucceeded(runCli(['--lang', 'en', '--plain', 'status']));
  const after = assertSucceeded(runCli(['status', '--plain', '--lang', 'en']));
  assert.equal(before, after);
  assert.match(before, /\[Community Sync Service\]/);
  assert.match(before, /\[Local Data Engine\]/);
  assert.doesNotMatch(before, /社区同步服务|本地数据引擎/);

  const zh = assertSucceeded(runCli(['--plain', '--lang', 'zh', 'status']));
  assert.match(zh, /【社区同步服务】/);
  assert.match(zh, /【本地数据引擎】/);

  const completionBefore = assertSucceeded(runCli(['--lang', 'en', 'completion', 'zsh']));
  const completionAfter = assertSucceeded(runCli(['completion', 'zsh', '--lang', 'en']));
  assert.equal(completionBefore, completionAfter);
  assert.match(completionBefore, /^#compdef kbu-usage/);
});

test('environment locale and localized entry-point failures are preserved end to end', (t) => {
  const runEnglish = isolatedCli(t, { extraEnv: { KBU_USAGE_LANG: 'en' } });
  const status = assertSucceeded(runEnglish(['status', '--plain']));
  assert.match(status, /Kimi Builders Usage Status/);

  const failed = runEnglish(['export', '--format', 'xlsx']);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^Command failed: Unsupported export format "xlsx"/);
});

test('calendar and rolling periods honor the CLI process timezone', (t) => {
  const offsetMilliseconds = (5 * 60 + 45) * 60 * 1000;
  const dayMilliseconds = 24 * 60 * 60 * 1000;
  const runCli = isolatedCli(t, { extraEnv: { TZ: 'Asia/Kathmandu' } });
  const today = JSON.parse(assertSucceeded(runCli([
    '--lang', 'en',
    'stats',
    '--period', 'today',
    '--json',
  ])));
  assert.equal(today.period.name, 'today');
  assert.equal((today.period.startMs + offsetMilliseconds) % dayMilliseconds, 0);
  assert.ok(today.period.endMs >= today.period.startMs);

  const rolling = JSON.parse(assertSucceeded(runCli([
    'stats',
    '--json',
    '--period', '24h',
    '--lang', 'en',
  ])));
  assert.equal(rolling.period.name, '24h');
  assert.equal(rolling.period.endMs - rolling.period.startMs, dayMilliseconds);
});

test('real export neutralizes CSV formulas from a scanned fixture', (t) => {
  const runCli = isolatedCli(t, { cursor: true });
  const csv = assertSucceeded(runCli([
    '--plain',
    'export',
    '--format', 'csv',
    '--type', 'buckets',
    '--period', 'all',
  ]));
  for (const safeValue of ["'=1+1", "'+SUM(1;1)", "'-1+1", "'@cmd"]) {
    assert.ok(csv.includes(safeValue), `${safeValue} should be neutralized in the exported CSV`);
  }
  for (const unsafeValue of [',=1+1,', ',+SUM(1;1),', ',-1+1,', ',@cmd,']) {
    assert.equal(csv.includes(unsafeValue), false, `${unsafeValue} must not remain executable`);
  }
});

test('real export applies the versioned pricing fixture', (t) => {
  const runCli = isolatedCli(t, { cursor: true });
  const csv = assertSucceeded(runCli([
    'export',
    '--period', 'all',
    '--type', 'buckets',
    '--format', 'csv',
    '--plain',
  ]));
  const [header, ...rows] = csv.trim().split('\n').map((line) => line.split(','));
  const columns = Object.fromEntries(header.map((name, index) => [name, index]));
  const row = rows.find((item) => item[columns.model] === pricingFixture.model);
  assert.ok(row, `missing ${pricingFixture.model} row from the real CLI export`);
  assert.equal(Number(row[columns.input_tokens]), pricingFixture.inputTokens);
  assert.equal(Number(row[columns.cache_read_input_tokens]), pricingFixture.cacheReadInputTokens);
  assert.equal(Number(row[columns.output_tokens]), pricingFixture.outputTokens);
  assert.equal(Number(row[columns.total_tokens]), pricingFixture.totalTokens);
  assert.equal(row[columns.cost_usd], pricingFixture.costUsd);
  assert.equal(row[columns.pricing_status], pricingFixture.pricingStatus);
  assert.equal(row[columns.price_version], pricingFixture.catalogVersion);
});
