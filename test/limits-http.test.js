import assert from 'node:assert/strict';
import test from 'node:test';
import { requestJson, requestText } from '../src/limits/http.js';

test('quota HTTP layer classifies authentication, upstream, and invalid-payload failures', async () => {
  await assert.rejects(
    requestJson('https://api.anthropic.com/api/oauth/usage', {
      fetcher: async () => new Response('{"error":"expired"}', { status: 401 }),
    }),
    (error) => error.code === 'unauthorized' && error.status === 401,
  );
  await assert.rejects(
    requestJson('https://api.anthropic.com/api/oauth/usage', {
      fetcher: async () => new Response('{"error":"maintenance"}', { status: 503 }),
    }),
    (error) => error.code === 'provider_error' && error.status === 503,
  );
  await assert.rejects(
    requestJson('https://api.anthropic.com/api/oauth/usage', {
      fetcher: async () => new Response('<!doctype html>', { status: 200 }),
    }),
    (error) => error.code === 'invalid_response',
  );
});

test('quota HTTP layer blocks undeclared origins before invoking fetch', async () => {
  let called = false;
  await assert.rejects(
    requestJson('https://example.invalid/private', { fetcher: async () => { called = true; } }),
    (error) => error.code === 'blocked_endpoint',
  );
  assert.equal(called, false);
});

test('quota HTTP layer classifies offline and timeout failures without real network access', async () => {
  await assert.rejects(
    requestText('https://opencode.ai/_server', { fetcher: async () => { throw new Error('offline'); } }),
    (error) => error.code === 'network_error',
  );
  await assert.rejects(
    requestJson('https://api.github.com/copilot_internal/user', {
      timeoutMs: 5,
      fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }),
    }),
    (error) => error.code === 'timeout',
  );
});

