import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No collector-specific data-dir override here: the parser must resolve the data root via
// KIMI_CODE_HOME, exactly like the Kimi Code CLI itself does.
const root = mkdtempSync(join(tmpdir(), 'vibe-usage-kimi-home-test-'));
const customHome = join(root, 'custom-kimi-home');
const legacyRoot = join(root, 'kimi-legacy');
process.env.KIMI_CODE_HOME = customHome;
process.env.KBU_USAGE_KIMI_DIR = legacyRoot;

const { parse, currentKimiHomes, roots } = await import('../src/parsers/kimi-code.js');

after(() => {
  delete process.env.KIMI_CODE_HOME;
  rmSync(root, { recursive: true, force: true });
});

test('parser honors KIMI_CODE_HOME when resolving the sessions root', async () => {
  const start = Date.parse('2026-07-20T08:01:00.000Z');
  const mainDir = join(customHome, 'sessions', 'wd_homeproj_abcd', 'session_9', 'agents', 'main');
  mkdirSync(mainDir, { recursive: true });
  writeFileSync(join(mainDir, 'wire.jsonl'), `${JSON.stringify({
    type: 'usage.record',
    model: 'kimi-code/k3',
    usage: { inputOther: 5, output: 1, inputCacheRead: 0, inputCacheCreation: 0 },
    usageScope: 'turn',
    time: start,
  })}\n`, 'utf-8');

  const result = await parse({ home: root, sessionSalt: 'test-session-salt'.padEnd(32, 'x') });
  assert.equal(result.buckets.length, 1);
  assert.equal(result.buckets[0].project, 'homeproj');
  assert.equal(result.buckets[0].inputTokens, 5);
});

test('desktop and CLI merge distinct calls, partial copies, and per-root project labels', async () => {
  const options = { home: root, platform: 'darwin', environment: { KIMI_CODE_HOME: join(root, 'cli-two') } };
  const [cli, desktop] = currentKimiHomes(options);
  const at = Date.parse('2026-11-22T12:00:00Z');
  const salt = 's'.repeat(32);
  const record = n => ({ type: 'usage.record', model: 'ABC/k3.1-pro', time: at + n, usage: { inputOther: n } });
  const put = (home, session, values) => {
    const dir = join(home, 'sessions', 'wd_fallback_abcd', session, 'agents', 'main');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'wire.jsonl'), values.map(n => JSON.stringify(record(n))).join('\n'));
    return join(dir, '..', '..');
  };
  put(cli, 'session_a', [1, 1]);
  put(desktop, 'session_a', [1, 1, 2]);
  const sessionDir = put(desktop, 'session_b', [4]);
  writeFileSync(join(desktop, 'session_index.jsonl'), JSON.stringify({ sessionDir, workDir: '/projects/desktop-only' }));
  const res = await parse({ ...options, sessionSalt: salt });
  assert.ok(roots(options).includes(desktop));
  assert.equal(res.sessions.length, 2);
  assert.deepEqual(res.buckets.map(b => [b.project, b.inputTokens, b.requestCount, b.modelCanonical]).sort(), [
    ['desktop-only', 4, 1, 'kimi-k3.1-pro'], ['fallback', 4, 3, 'kimi-k3.1-pro'],
  ]);
  const override = await parse({ ...options, environment: { KBU_USAGE_KIMI_CODE_DIR: cli }, sessionSalt: salt });
  assert.equal(override.sessions.length, 1);
  assert.equal(override.buckets[0].requestCount, 2);
});

test('desktop discovery follows the platform config directory', () => {
  assert.match(currentKimiHomes({ platform: 'win32', home: 'C:\\home', environment: { APPDATA: 'D:\\app' } })[1], /^D:\\app\\kimi-desktop\\/);
  assert.match(currentKimiHomes({ platform: 'linux', home: '/home/test', environment: { XDG_CONFIG_HOME: '/custom' } })[1], /^\/custom\/kimi-desktop\//);
});

test('private CLI policy excludes Work until explicitly opted in; copied wires keep the CLI checkpoint identity', async () => {
  const options = { home: join(root, 'consent'), platform: 'linux', environment: {} };
  const [cli, work] = currentKimiHomes(options);
  const salt = 's'.repeat(32);
  const put = (dir) => {
    const session = join(dir, 'sessions', 'wd_proj_abcd', 'session_private');
    const agent = join(session, 'agents', 'main');
    mkdirSync(agent, { recursive: true });
    writeFileSync(join(agent, 'wire.jsonl'), JSON.stringify({ type: 'usage.record', time: Date.parse('2026-11-22T10:01:00Z'),
      model: 'k3', usage: { inputOther: 5 } }));
    return session;
  };
  put(work);
  const read = (args) => parse({ ...options, sessionSalt: salt, ...args });
  const scan = await read({});
  assert.equal((await read({ purpose: 'sync' })).sessions.length, 0);
  assert.ok(!roots({ ...options, purpose: 'sync' }).includes(work));
  const opted = await read({ purpose: 'sync', sourceOptions: { 'kimi-code': { syncDesktop: true } } });
  assert.deepEqual(opted.sessions, scan.sessions);
  const session = put(cli);
  const { sessions } = await read({});
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionHash, scan.sessions[0].sessionHash);
  assert.equal(sessions[0].sessionHash, createHmac('sha256', salt).update(session).digest('hex'));
});
