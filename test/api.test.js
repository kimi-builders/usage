import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { encodeIngestBody, ingest, parseRetryAfterMs } from '../src/api.js';

test('ingest payloads are always gzip encoded', () => {
  const payload = {
    protocolVersion: 2,
    client: { syncId: 'fixture' },
    buckets: [],
    sessions: [],
  };
  const encoded = encodeIngestBody(payload);
  assert.deepEqual(JSON.parse(gunzipSync(encoded).toString('utf8')), payload);
});

test('Retry-After parses delta seconds and HTTP dates with a bounded wait', () => {
  assert.equal(parseRetryAfterMs('2', 0), 2_000);
  assert.equal(parseRetryAfterMs(new Date(3_000).toUTCString(), 1_000), 2_000);
  assert.equal(parseRetryAfterMs('86400', 0), 60_000);
  assert.equal(parseRetryAfterMs('not-a-date', 0), null);
});

test('ingest retries a 429 response using Retry-After', async () => {
  let attempts = 0;
  const server = createServer((request, response) => {
    request.resume();
    attempts += 1;
    response.setHeader('Content-Type', 'application/json');
    if (attempts === 1) {
      response.statusCode = 429;
      response.setHeader('Retry-After', '0');
      response.end(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }));
      return;
    }
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const result = await ingest(
      `http://127.0.0.1:${address.port}`,
      `kbu_${'a'.repeat(43)}`,
      { protocolVersion: 2, client: { syncId: 'fixture' }, buckets: [], sessions: [] },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
