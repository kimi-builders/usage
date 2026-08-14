import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCommunityUrl } from '../src/community-url.js';

test('community API accepts HTTPS and loopback HTTP while normalizing to an origin', () => {
  assert.equal(normalizeCommunityUrl('https://example.com/custom/path?x=1'), 'https://example.com');
  assert.equal(normalizeCommunityUrl('http://127.0.0.1:43120/path'), 'http://127.0.0.1:43120');
  assert.equal(normalizeCommunityUrl('http://dev.localhost:3000'), 'http://dev.localhost:3000');
});

test('community API rejects remote plaintext, credentials, and unsupported schemes', () => {
  for (const value of [
    'http://example.com',
    'https://user:secret@example.com',
    'file:///tmp/community',
    'not a url',
  ]) assert.throws(() => normalizeCommunityUrl(value));
});
