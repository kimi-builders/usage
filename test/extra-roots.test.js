import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  antigravityConversationDirs, discoverCodexHomes, publicExtraRoots,
} from '../src/extra-roots.js';

test('extra-root discovery is bounded and browser metadata omits full paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-extra-roots-'));
  const codexHome = join(directory, 'workspace', 'task', 'codex-home');
  const tooDeep = join(directory, 'one', 'two', 'three', 'four', 'codex-home');
  const antigravity = join(directory, '.gemini', 'antigravity', 'conversations');
  const standaloneIde = join(directory, '.gemini', 'antigravity-ide', 'conversations');
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  mkdirSync(join(tooDeep, 'sessions'), { recursive: true });
  mkdirSync(antigravity, { recursive: true });
  mkdirSync(standaloneIde, { recursive: true });
  try {
    assert.deepEqual(discoverCodexHomes(directory), [codexHome]);
    assert.deepEqual(new Set(antigravityConversationDirs(directory)), new Set([antigravity, standaloneIde]));
    const metadata = publicExtraRoots({ codex: { extraRoots: [directory] } }, 'codex');
    assert.equal(metadata[0].label, basename(directory));
    assert.equal(JSON.stringify(metadata).includes(directory), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Codex extra-root discovery stops at a fixed entry budget', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kbu-extra-roots-limit-'));
  mkdirSync(join(directory, 'one'), { recursive: true });
  mkdirSync(join(directory, 'two'), { recursive: true });
  try {
    assert.throws(
      () => discoverCodexHomes(directory, 3, { maxDirectories: 10, maxEntries: 1 }),
      (error) => error?.code === 'extra_root_scan_limit' && /narrower directory/.test(error.message),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
