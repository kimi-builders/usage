import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Guard: with the overrides pointing at empty/nonexistent fixtures, the
// registry must resolve exactly those dirs and never fall back to the
// developer's real data dirs (~/.claude, ~/.codex, ~/.gemini, ...).
const root = mkdtempSync(join(tmpdir(), 'kbu-roots-test-'));
process.env.KBU_USAGE_KIMI_CODE_DIR = join(root, 'kimi-code-absent');
process.env.KBU_USAGE_KIMI_DIR = join(root, 'kimi-legacy-absent');
process.env.KBU_USAGE_CLAUDE_DIRS = '';
process.env.KBU_USAGE_CODEX_HOME = join(root, 'codex-absent');
process.env.KBU_USAGE_OPENCODE_DIR = join(root, 'opencode-absent');
process.env.KBU_USAGE_GEMINI_DIR = join(root, 'gemini-absent');
process.env.KBU_USAGE_ANTIGRAVITY_DIR = join(root, 'antigravity-absent');
process.env.KBU_USAGE_COPILOT_DIR = join(root, 'copilot-absent');
process.env.KBU_USAGE_ROO_DIRS = join(root, 'roo-absent');
process.env.KBU_USAGE_PI_SESSION_DIRS = join(root, 'pi-absent');
process.env.KBU_USAGE_ZCODE_DB = join(root, 'zcode-absent.sqlite');
process.env.KBU_USAGE_WORKBUDDY_DIRS = join(root, 'workbuddy-absent');
process.env.KBU_USAGE_CURSOR_CSV = join(root, 'cursor-absent.csv');

const { sourceRegistry, enabledSources, parsers } = await import('../src/parsers/index.js');

after(() => rmSync(root, { recursive: true, force: true }));

const EXPECTED = [
  { id: 'kimi-code', tier: 'core' },
  { id: 'claude-code', tier: 'stable' },
  { id: 'codex', tier: 'stable' },
  { id: 'opencode', tier: 'stable' },
  { id: 'gemini-cli', tier: 'stable' },
  { id: 'antigravity', tier: 'stable' },
  { id: 'copilot-cli', tier: 'stable' },
  { id: 'roo-code', tier: 'stable' },
  { id: 'pi-coding-agent', tier: 'beta' },
  { id: 'zcode', tier: 'beta' },
  { id: 'workbuddy', tier: 'beta' },
  { id: 'cursor', tier: 'explicit-opt-in' },
];

test('registry holds exactly the expected sources and tiers', () => {
  assert.deepEqual(
    sourceRegistry.map(({ id, tier }) => ({ id, tier })),
    EXPECTED,
  );
  assert.equal(enabledSources().length, EXPECTED.length - 1);
  assert.equal(enabledSources(['cursor']).at(-1).id, 'cursor');
  assert.deepEqual(Object.keys(parsers), EXPECTED.map(({ id }) => id));
});

test('overrides pointing at nothing resolve to no roots, never the real HOME', async () => {
  const salt = 'test-session-salt'.padEnd(32, 'x');
  for (const source of enabledSources(['cursor'])) {
    assert.deepEqual(source.roots(), [], `${source.id} leaked a real data dir`);
    // kimi-code parses missing roots into an empty result; the other sources
    // report themselves as not installed (null).
    const result = await source.parse({ sessionSalt: salt });
    if (source.id === 'kimi-code') {
      assert.deepEqual(result, { buckets: [], sessions: [] });
    } else {
      assert.equal(result, null, `${source.id} parsed without roots`);
    }
  }
});
