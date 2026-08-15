import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommunityStatus } from '../src/device-authorization.js';

test('community connection status distinguishes disconnected and connected devices', () => {
  assert.equal(resolveCommunityStatus(null, 1), 'disconnected');
  assert.equal(resolveCommunityStatus({ connected: false }, 1), 'disconnected');
  assert.equal(resolveCommunityStatus({ connected: true }, 1), 'connected');
  assert.equal(resolveCommunityStatus({ connected: true, status: 'error' }, 1), 'error');
});

test('pending device authorization changes to expired only after its deadline', () => {
  const deadline = Date.parse('2026-08-14T12:00:00.000Z');
  const community = {
    connected: false,
    status: 'pending',
    authorization: { expiresAt: '2026-08-14T12:00:00.000Z' },
  };

  assert.equal(resolveCommunityStatus(community, deadline - 1), 'pending');
  assert.equal(resolveCommunityStatus(community, deadline), 'expired');
  assert.equal(resolveCommunityStatus(community, deadline + 1), 'expired');
});

test('pending authorization without a trustworthy deadline remains pending', () => {
  assert.equal(resolveCommunityStatus({ status: 'pending' }, 1), 'pending');
  assert.equal(resolveCommunityStatus({ status: 'pending', authorization: { expiresAt: 'invalid' } }, 1), 'pending');
});
