import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queryDbJson } from './sqlite.js';

/**
 * Offline reader for Antigravity SQLite conversation stores.
 *
 * Antigravity 2.0 (standalone app) and the `agy` CLI both persist each cascade
 * as a per-conversation SQLite `.db` file whose `gen_metadata` table holds one
 * protobuf-encoded GeneratorMetadata per row. Unlike the legacy `.pb` files
 * (which are encrypted/opaque and only decodable by a running language server),
 * these blobs are plain protobuf, so token usage is extracted directly from
 * disk — no running process, no RPC.
 *
 * The wire-format tag numbers below were cross-verified against the language
 * server's GetCascadeTrajectory JSON for the same responseId:
 *
 *   chatModel = field 1
 *     usage = field 4
 *       inputTokens          = 4.2
 *       outputTokens         = 4.3
 *       cacheReadTokens      = 4.5
 *       thinkingOutputTokens = 4.9
 *       responseId           = 4.11
 *     chatStartMetadata = field 9
 *       createdAt (Timestamp) = 9.4  → seconds = 9.4.1
 *     responseModel      = field 19  ("gemini-3-flash-a" / "gemini-default")
 *     modelDisplayName   = field 21  ("Gemini 3.5 Flash (High/Medium/Low)")
 */

// ── Minimal protobuf wire-format decoder (no dependency) ──────────────

/** Read a base-128 varint. Returns [value: number, newPos]. */
function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  while (pos < buf.length) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [Number(result), pos];
    }
    shift += 7n;
    if (shift > 63n) break;
  }
  throw new Error('Antigravity protobuf contains an incomplete integer');
}

/**
 * Decode one protobuf message into Map<fieldNumber, Array<{wireType, value}>>.
 * Length-delimited values are kept as raw Buffers (caller decides string vs
 * sub-message). Unknown wire types abort parsing of the rest of the message.
 */
function decodeMessage(buf) {
  const fields = new Map();
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;
    if (fieldNum <= 0) throw new Error('Antigravity protobuf has an invalid field');
    let value;
    if (wireType === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wireType === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      if (len > buf.length - pos) throw new Error('Antigravity protobuf has an incomplete field');
      value = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) throw new Error('Antigravity protobuf has an incomplete field');
      value = buf.subarray(pos, pos + 4);
      pos += 4;
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) throw new Error('Antigravity protobuf has an incomplete field');
      value = buf.subarray(pos, pos + 8);
      pos += 8;
    } else {
      throw new Error('Antigravity protobuf has an unsupported field');
    }
    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum).push({ wireType, value });
  }
  return fields;
}

function firstVarint(fields, num) {
  const arr = fields.get(num);
  const entry = arr && arr.find((x) => x.wireType === 0);
  // Unrelated protobuf fields can be 64-bit IDs/flags and are never used by
  // this collector. Only selected counters, indices and clocks must be safe.
  if (entry && !Number.isSafeInteger(entry.value)) throw new Error('Antigravity protobuf integer exceeds safe range');
  return entry ? entry.value : undefined;
}

function firstBytes(fields, num) {
  const arr = fields.get(num);
  const entry = arr && arr.find((x) => x.wireType === 2);
  return entry ? entry.value : undefined;
}

function firstString(fields, num) {
  const bytes = firstBytes(fields, num);
  return bytes ? Buffer.from(bytes).toString('utf-8') : undefined;
}

function firstMessage(fields, num) {
  const bytes = firstBytes(fields, num);
  return bytes ? decodeMessage(bytes) : undefined;
}

// ── GeneratorMetadata parsing ─────────────────────────────────────────

// ModelUsage is shared by generator rows, step metadata (9) and retries
// (generator 17.2 / step 28.2). Field 3 INCLUDES reasoning (field 9).
function parseUsageMessage(usage) {
  const thinking = firstVarint(usage, 9) || 0;
  const visible = firstVarint(usage, 10);
  const total = firstVarint(usage, 3) ?? thinking + (visible || 0);
  if (thinking > total || visible != null && (visible > total || thinking + visible > total)) {
    throw new Error('Antigravity output token split is inconsistent');
  }
  const outputTokens = visible ?? total - thinking;
  return {
    modelId: firstVarint(usage, 1) || 0,
    inputTokens: firstVarint(usage, 2) || 0,
    totalOutputTokens: total, outputTokens, thinkingOutputTokens: total - outputTokens,
    cacheCreationTokens: firstVarint(usage, 4) || 0,
    cacheReadTokens: firstVarint(usage, 5) || 0,
    messageId: firstString(usage, 7) || '', responseId: firstString(usage, 11) || '',
    providerMessageId: firstString(usage, 12) || '',
  };
}

export function hasTokenUsage(usage) {
  return Boolean(usage && (usage.inputTokens || usage.totalOutputTokens || usage.cacheCreationTokens || usage.cacheReadTokens));
}

function retryUsages(fields, number) {
  return (fields.get(number) || []).filter(entry => entry.wireType === 2).flatMap(entry => {
    const usage = firstMessage(decodeMessage(entry.value), 2);
    return usage ? [parseUsageMessage(usage)] : [];
  });
}

/**
 * Parse one gen_metadata blob into a normalized usage record, or null if it
 * carries no token usage (error/planning placeholders have none).
 */
export function parseGenMetadataBlob(buf) {
  const decoded = decodeMessage(buf);
  const chatModel = firstMessage(decoded, 1);
  if (!chatModel) return null;

  const usage = firstMessage(chatModel, 4);
  if (!usage) return null;

  const parsed = parseUsageMessage(usage);
  const retries = retryUsages(chatModel, 17);
  if (!hasTokenUsage(parsed) && !retries.some(hasTokenUsage)) return null;

  const chatStartMetadata = firstMessage(chatModel, 9);
  const createdAt = chatStartMetadata ? firstMessage(chatStartMetadata, 4) : undefined;
  const seconds = createdAt ? firstVarint(createdAt, 1) : undefined;
  const timestamp = seconds ? new Date(seconds * 1000) : null;

  let lastStepIndex = null;
  const metaEntries = chatModel.get(20) || [];
  for (const entry of metaEntries) {
    if (entry.wireType === 2 && entry.value) {
      const sub = decodeMessage(entry.value);
      if (firstString(sub, 1) === 'last_step_index') {
        const val = Number(firstString(sub, 2));
        if (Number.isFinite(val)) lastStepIndex = val;
      }
    }
  }

  return {
    ...parsed,
    retryUsages: retries,
    timestamp,
    lastStepIndex,
    displayName: firstString(chatModel, 21) || '',
    responseModel: firstString(chatModel, 19) || '',
  };
}

// ── SQLite store reading ──────────────────────────────────────────────

function isLockError(error) {
  return error && typeof error.message === 'string' && /database is locked/i.test(error.message);
}

function isSqliteUnavailableError(error) {
  return error && typeof error.message === 'string' && /ENOENT|sqlite3.*not found/i.test(error.message);
}

function queryCascadeDb(conversationsDir, cascadeId, sql) {
  const dbPath = join(conversationsDir, `${cascadeId}.db`);
  try {
    return queryDbJson(dbPath, sql);
  } catch (error) {
    if (isSqliteUnavailableError(error)) throw error;
    if (!isLockError(error)) throw error;

    // The App can hold the live DB open. Query a WAL-consistent snapshot so
    // one active cascade does not make the whole Antigravity parser go empty.
    const snapshotDir = mkdtempSync(join(tmpdir(), 'kbu-usage-antigravity-'));
    const snapshotPath = join(snapshotDir, `${cascadeId}.db`);
    try {
      copyFileSync(dbPath, snapshotPath);
      for (const suffix of ['-shm', '-wal']) {
        const companion = `${dbPath}${suffix}`;
        if (existsSync(companion)) copyFileSync(companion, `${snapshotPath}${suffix}`);
      }
      return queryDbJson(snapshotPath, sql);
    } finally {
      rmSync(snapshotDir, { recursive: true, force: true });
    }
  }
}

/** List cascade IDs backed by a `.db` file in a conversations directory. */
export function listDbCascades(conversationsDir) {
  const out = [];
  for (const file of readdirSync(conversationsDir)) {
    if (file.endsWith('.db') && file !== 'db.sqlite') out.push(file.slice(0, -3));
  }
  return out;
}

/**
 * Read all gen_metadata blobs from one cascade `.db` and return parsed usage
 * records. The blob is fetched as hex text so it round-trips through both
 * the node:sqlite and sqlite3-CLI backends uniformly.
 */
export function readDbUsageRecords(conversationsDir, cascadeId) {
  const rows = queryCascadeDb(conversationsDir, cascadeId, 'SELECT idx, hex(data) AS h FROM gen_metadata ORDER BY idx');
  const records = [];
  for (const row of rows) {
    if (!row.h) continue;
    // A corrupt usage row must not masquerade as a complete scan.
    const record = parseGenMetadataBlob(Buffer.from(row.h, 'hex'));
    if (record) records.push({ ...record, idx: row.idx });
  }
  return records;
}

/**
 * Read the workspace URI for a cascade from trajectory_metadata_blob.
 * Structure: field 1 = workspaces[0], 1.1 = workspaceFolderAbsoluteUri.
 * Returns the raw file:// URI, or null.
 */
export function readDbWorkspaceUri(conversationsDir, cascadeId) {
  let rows;
  try {
    rows = queryCascadeDb(conversationsDir, cascadeId, 'SELECT hex(data) AS h FROM trajectory_metadata_blob LIMIT 1');
  } catch (error) {
    if (isSqliteUnavailableError(error)) throw error;
    return null;
  }
  if (!rows.length || !rows[0].h) return null;
  try {
    const meta = decodeMessage(Buffer.from(rows[0].h, 'hex'));
    const workspace = firstMessage(meta, 1);
    return (workspace && firstString(workspace, 1)) || null;
  } catch {
    return null;
  }
}

// Step source enum in steps.metadata field 3 (behavior-verified against payload
// contents, since it mirrors the RPC's CORTEX_STEP_SOURCE_*): 4 = user turn,
// 2 = model turn. Everything else (system, tool, unspecified) is skipped.
const STEP_SOURCE_USER = 4;
const STEP_SOURCE_MODEL = 2;

/**
 * Parse one steps.metadata blob into a session-timing event, or null if the
 * step is neither a user nor a model turn. createdAt is a Timestamp at
 * field 1 (seconds at 1.1); source enum is field 3.
 */
export function parseStepMetadata(buf) {
  const meta = decodeMessage(buf);
  const source = firstVarint(meta, 3);
  let role;
  if (source === STEP_SOURCE_USER) role = 'user';
  else if (source === STEP_SOURCE_MODEL) role = 'assistant';
  else return null;

  const createdAt = firstMessage(meta, 1);
  const seconds = createdAt ? firstVarint(createdAt, 1) : undefined;
  if (!seconds) return null;

  return { role, timestamp: new Date(seconds * 1000) };
}

/** Read session timing events (user/assistant turns) for a cascade. */
export function readDbSessionEvents(conversationsDir, cascadeId) {
  return readDbStepRows(conversationsDir, cascadeId).events;
}

export function readDbStepRows(conversationsDir, cascadeId) {
  const rows = queryCascadeDb(
      conversationsDir,
      cascadeId,
      'SELECT idx, hex(metadata) AS h FROM steps WHERE metadata IS NOT NULL ORDER BY idx',
    );
  const events = [];
  const usages = [];
  const timestamps = new Map();
  for (const row of rows) {
    if (!row.h) continue;
    const blob = Buffer.from(row.h, 'hex');
    const meta = decodeMessage(blob);
    const event = parseStepMetadata(blob);
    if (event) events.push(event);
    const seconds = [1, 8].map(field => {
      const created = firstMessage(meta, field);
      return created && firstVarint(created, 1);
    }).find(Boolean);
    const date = seconds ? new Date(seconds * 1000) : null;
    const timestamp = date && Number.isFinite(+date) ? date : null;
    if (timestamp) timestamps.set(row.idx, timestamp);
    const usage = firstMessage(meta, 9);
    const model = firstMessage(meta, 24);
    const modelName = model && (firstString(model, 12) || firstString(model, 8)) || '';
    const main = usage ? parseUsageMessage(usage) : null;
    const retries = retryUsages(meta, 28);
    if (hasTokenUsage(main) || retries.some(hasTokenUsage)) {
      usages.push({ usage: main, retryUsages: retries, timestamp, modelName,
        modelId: model && firstVarint(model, 1) || 0, idx: row.idx });
    }
  }
  return { events, usages, timestamps };
}
