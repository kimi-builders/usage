import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// KBU_USAGE_ANTIGRAVITY_DIR points at an isolated conversations dir before
// import so the developer's real ~/.gemini/antigravity* can never leak in.
const root = mkdtempSync(join(tmpdir(), 'kbu-antigravity-test-'));
process.env.KBU_USAGE_ANTIGRAVITY_DIR = join(root, 'placeholder');

const { parse, roots } = await import('../src/parsers/antigravity.js');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // node:sqlite unavailable (Node < 22.5) — these tests skip.
}

const SALT = 'test-session-salt'.padEnd(32, 'x');

after(() => rmSync(root, { recursive: true, force: true }));

// ── Minimal protobuf encoder (mirrors the wire format the decoder reads) ──
function varint(n) {
  const bytes = [];
  let value = BigInt(n);
  do {
    let byte = Number(value & 0x7fn);
    value >>= 7n;
    if (value > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0n);
  return Buffer.from(bytes);
}
const tag = (num, wire) => varint((num << 3) | wire);
const vfield = (num, val) => Buffer.concat([tag(num, 0), varint(val)]);
const lfield = (num, buf) => Buffer.concat([tag(num, 2), varint(buf.length), buf]);
const sfield = (num, str) => lfield(num, Buffer.from(str, 'utf-8'));

// GeneratorMetadata blob: chatModel(1) { usage(4), chatStartMetadata(9),
// responseModel(19), modelDisplayName(21) } — tag numbers cross-verified
// against the language server's GetCascadeTrajectory JSON.
function buildUsageBlob({ input, output, cache, thinking, responseId, seconds, responseModel, displayName }) {
  const usageParts = [];
  if (input != null) usageParts.push(vfield(2, input));
  if (output != null) usageParts.push(vfield(3, output));
  if (cache != null) usageParts.push(vfield(5, cache));
  if (thinking != null) usageParts.push(vfield(9, thinking));
  if (responseId != null) usageParts.push(sfield(11, responseId));

  const chatModelParts = [];
  if (usageParts.length) chatModelParts.push(lfield(4, Buffer.concat(usageParts)));
  if (seconds != null) chatModelParts.push(lfield(9, lfield(4, vfield(1, seconds))));
  if (responseModel != null) chatModelParts.push(sfield(19, responseModel));
  if (displayName != null) chatModelParts.push(sfield(21, displayName));

  return lfield(1, Buffer.concat(chatModelParts));
}

// steps.metadata: createdAt Timestamp at field 1 (seconds=1.1), source enum
// at field 3 (4=user, 2=model, anything else skipped).
function buildStepBlob({ source, seconds }) {
  const parts = [];
  if (seconds != null) parts.push(lfield(1, vfield(1, seconds)));
  if (source != null) parts.push(vfield(3, source));
  return Buffer.concat(parts);
}

function useDir(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  process.env.KBU_USAGE_ANTIGRAVITY_DIR = dir;
  return dir;
}

function buildCascade(dir, cascadeId, { usageBlobs = [], stepBlobs = [], workspaceUri = null }) {
  const db = new DatabaseSync(join(dir, `${cascadeId}.db`));
  try {
    db.exec(`
      CREATE TABLE gen_metadata (idx INTEGER, data BLOB);
      CREATE TABLE trajectory_metadata_blob (data BLOB);
      CREATE TABLE steps (idx INTEGER, metadata BLOB);
    `);
    const insertUsage = db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)');
    usageBlobs.forEach((blob, index) => insertUsage.run(index, blob));
    if (workspaceUri) {
      db.prepare('INSERT INTO trajectory_metadata_blob (data) VALUES (?)')
        .run(lfield(1, sfield(1, workspaceUri)));
    }
    const insertStep = db.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)');
    stepBlobs.forEach((blob, index) => insertStep.run(index, blob));
  } finally {
    db.close();
  }
}

function sumTokens(result) {
  const sum = (key) => result.buckets.reduce((total, bucket) => total + bucket[key], 0);
  return {
    input: sum('inputTokens'),
    cacheWrite: sum('cacheWriteInputTokens'),
    cacheRead: sum('cacheReadInputTokens'),
    output: sum('outputTokens'),
    reasoning: sum('reasoningOutputTokens'),
    requests: result.buckets.reduce((total, bucket) => total + bucket.requestCount, 0),
  };
}

test('missing conversations dir reports not installed (null)', async () => {
  process.env.KBU_USAGE_ANTIGRAVITY_DIR = join(root, 'absent');
  assert.deepEqual(roots(), []);
  assert.equal(await parse({ sessionSalt: SALT }), null);
});

test('sqlite cascade: token mapping, display-name model, workspace project, steps timing', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('basic');
  buildCascade(dir, 'cascade-1', {
    workspaceUri: 'file:///Users/example/project-one',
    usageBlobs: [
      buildUsageBlob({
        input: 5528, output: 192, cache: 2000, thinking: 142,
        responseId: 'RESP_1', seconds: 1785578520,
        responseModel: 'gemini-default', displayName: 'Gemini 3.5 Flash (High)',
      }),
    ],
    stepBlobs: [
      buildStepBlob({ source: 4, seconds: 1785578460 }),
      buildStepBlob({ source: 2, seconds: 1785578520 }),
      buildStepBlob({ source: 5, seconds: 1785578530 }), // system/tool → skipped
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 5528, cacheWrite: 0, cacheRead: 2000, output: 192, reasoning: 142, requests: 1,
  });
  assert.equal(result.buckets[0].model, 'gemini-3.5-flash');
  assert.equal(result.buckets[0].reasoningEffort, 'high');
  assert.equal(result.buckets[0].project, 'project-one');
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].messageCount, 2);
  assert.equal(result.sessions[0].userMessageCount, 1);
});

test('responseModel slug is normalized when no display name exists', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('slug');
  buildCascade(dir, 'cascade-1', {
    usageBlobs: [
      buildUsageBlob({ input: 10, output: 5, seconds: 1785578520, responseModel: 'gemini-3-pro-high' }),
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.equal(result.buckets[0].model, 'gemini-3-pro');
  assert.equal(result.buckets[0].project, 'unknown');
});

test('responseId dedup across cascades; usage-less rows never become entries', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('dedup');
  const shared = buildUsageBlob({
    input: 100, output: 10, responseId: 'RESP_DUP', seconds: 1785578520, displayName: 'Gemini 3.5 Flash (Low)',
  });
  buildCascade(dir, 'cascade-1', {
    usageBlobs: [
      shared,
      // no usage sub-message (error/planning placeholder) → ignored
      buildUsageBlob({ seconds: 1785578530, displayName: 'Gemini 3.5 Flash (Low)' }),
    ],
  });
  // A second cascade re-records the same responseId (App + CLI store overlap).
  buildCascade(dir, 'cascade-2', { usageBlobs: [shared] });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 100, cacheWrite: 0, cacheRead: 0, output: 10, reasoning: 0, requests: 1,
  });
});

test('records without timestamps are dropped; steps-only cascade still yields a session', async (t) => {
  if (!DatabaseSync) return t.skip('node:sqlite unavailable');
  const dir = useDir('timing');
  buildCascade(dir, 'cascade-1', {
    usageBlobs: [buildUsageBlob({ input: 999, output: 9, responseId: 'RESP_NO_TS' })],
  });
  buildCascade(dir, 'cascade-2', {
    workspaceUri: 'file:///x/steps-only',
    stepBlobs: [
      buildStepBlob({ source: 4, seconds: 1785578460 }),
      buildStepBlob({ source: 2, seconds: 1785578580 }),
      buildStepBlob({ source: 2, seconds: 1785578700 }),
    ],
  });
  const result = await parse({ sessionSalt: SALT });
  assert.deepEqual(sumTokens(result), {
    input: 0, cacheWrite: 0, cacheRead: 0, output: 0, reasoning: 0, requests: 0,
  });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].project, 'steps-only');
  assert.equal(result.sessions[0].activeSeconds, 120);
});
