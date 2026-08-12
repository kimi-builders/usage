import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LIMIT_ALLOWED_HOSTS } from '../src/limits/http.js';

const providerDirectory = fileURLToPath(new URL('../src/limits/providers/', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('./fixtures/', import.meta.url));
const networkDocument = readFileSync(new URL('../NETWORK.md', import.meta.url), 'utf8');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('every hard-coded quota endpoint is HTTPS, allowlisted, and declared in NETWORK.md', () => {
  const endpoints = files(providerDirectory)
    .filter((file) => file.endsWith('.js'))
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/https:\/\/[^'"`\s)]+/g)].map((match) => match[0]));
  assert.ok(endpoints.length >= 10);
  for (const endpoint of endpoints) {
    const hostname = new URL(endpoint).hostname;
    assert.equal(LIMIT_ALLOWED_HOSTS.has(hostname), true, `${hostname} is not in the quota allowlist`);
    assert.match(networkDocument, new RegExp(hostname.replaceAll('.', '\\.')));
  }
});

test('test fixtures remain bounded and do not contain credential-shaped material', () => {
  const fixtureFiles = files(fixturesDirectory);
  for (const file of fixtureFiles) {
    assert.ok(statSync(file).size <= 512 * 1024, `${basename(file)} exceeds the 512 KiB fixture limit`);
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
    assert.doesNotMatch(text, /\b(?:access|refresh)[_-]?token\b\s*["'=:\s]+[A-Za-z0-9._-]{20,}/i);
    assert.doesNotMatch(text, /\bBearer\s+[A-Za-z0-9._-]{20,}/i);
  }
});
