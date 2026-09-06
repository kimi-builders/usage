import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCodexCredentials, loadCursorCredentials } from '../src/limits/credentials.js';
import { fetchCodexLimits } from '../src/limits/providers/codex.js';

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function tempDirectory(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Cursor local auth decodes ASCII JWTs stored as UTF-16LE SQLite BLOBs', (t) => {
  const root = tempDirectory(t, 'usage-cursor-auth-');
  const path = join(root, 'state.vscdb');
  writeFileSync(path, 'fixture');
  const accessToken = jwt({ sub: 'auth0|cursor-user', exp: Math.floor(Date.now() / 1_000) + 3_600 });
  const result = loadCursorCredentials({ CURSOR_STATE_DB: path }, {
    query: () => [{ value: Buffer.from(accessToken, 'utf16le') }],
  });
  assert.equal(result.found, true);
  assert.equal(result.fresh, true);
  assert.equal(result.accessToken, accessToken);
  assert.equal(result.cookie, `WorkosCursorSessionToken=cursor-user%3A%3A${accessToken}`);
});

test('Codex local auth honors access-token JWT expiry and preserves opaque tokens', (t) => {
  const root = tempDirectory(t, 'usage-codex-auth-');
  const idToken = jwt({ email: 'builder@example.com', chatgpt_plan_type: 'pro' });
  const writeAuth = (accessToken) => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
      access_token: accessToken, id_token: idToken, account_id: 'account-1',
    } }));
  };

  writeAuth(jwt({ exp: Math.floor(Date.now() / 1_000) - 60 }));
  const expired = loadCodexCredentials({ CODEX_HOME: root });
  assert.equal(expired.found, true);
  assert.equal(expired.fresh, false);
  assert.equal(expired.email, 'builder@example.com');

  writeAuth('opaque-access-token');
  const opaque = loadCodexCredentials({ CODEX_HOME: root });
  assert.equal(opaque.found, true);
  assert.equal(opaque.fresh, true);
  assert.equal(opaque.expiresAt, null);
});

test('Codex quota fetch rejects an expired local token before network access', async (t) => {
  const root = tempDirectory(t, 'usage-codex-expired-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'auth.json'), JSON.stringify({ tokens: {
    access_token: jwt({ exp: Math.floor(Date.now() / 1_000) - 1 }),
  } }));
  let networkCalls = 0;
  await assert.rejects(fetchCodexLimits({
    environment: { CODEX_HOME: root },
    fetcher: async () => {
      networkCalls += 1;
      throw new Error('network must not be reached');
    },
  }), (error) => error?.code === 'unauthorized' && /重新登录/.test(error.message));
  assert.equal(networkCalls, 0);
});
