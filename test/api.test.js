import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { encodeIngestBody } from '../src/api.js';

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

