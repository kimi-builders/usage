import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'kbu-sources-test-'));
const configDir = join(root, 'config');
const csv = join(root, 'cursor.csv');
process.env.KBU_USAGE_CONFIG_DIR = configDir;
writeFileSync(csv, 'Date,Model,Input Tokens\n', 'utf8');

const { runSources } = await import('../src/sources.js');

after(() => rmSync(root, { recursive: true, force: true }));

test('local Cursor source can be configured before community initialization', () => {
  runSources(['enable', 'cursor', '--csv', csv]);
  const configPath = join(configDir, 'config.json');
  assert.equal(existsSync(configPath), true);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.apiKey, undefined);
  assert.equal(config.sessionSalt.length, 64);
  assert.deepEqual(config.enabledSources, ['cursor']);
  assert.equal(config.sourceOptions.cursor.csvPath, csv);

  runSources(['disable', 'cursor']);
  const disabled = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.deepEqual(disabled.enabledSources, []);
  assert.equal(disabled.sessionSalt, config.sessionSalt);
});

test('source listing labels compatibility-beta parsers without disabling them', () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    runSources(['list']);
  } finally {
    console.log = original;
  }
  for (const source of ['pi-coding-agent', 'zcode', 'workbuddy']) {
    assert.ok(lines.some((line) => line.includes(source) && line.includes('Beta')));
  }
});
