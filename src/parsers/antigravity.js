import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';
import { antigravityConversationDirs, configuredExtraRoots } from '../extra-roots.js';
import {
  listDbCascades,
  hasTokenUsage,
  readDbStepRows,
  readDbUsageRecords,
  readDbWorkspaceUri,
} from './antigravity-db.js';

/**
 * Antigravity parser (Google Antigravity IDE + `agy` CLI).
 *
 * Conversation stores scanned:
 *   ~/.gemini/antigravity/conversations/*.db        (App 2.0)
 *   ~/.gemini/antigravity-cli/conversations/*.db    (agy CLI)
 *   ~/.gemini/antigravity-ide/conversations/*.db    (standalone IDE)
 * KBU_USAGE_ANTIGRAVITY_DIR overrides all defaults with one conversations dir.
 *
 * Only the offline SQLite path is ported: each cascade is a per-conversation
 * `.db` of plain-protobuf blobs (see antigravity-db.js). The legacy `.pb`
 * store — encrypted, decodable only through a running language server's
 * GetCascadeTrajectory RPC — is intentionally NOT read (process discovery +
 * RPC is out of scope for a local collector); App 2.0 / CLI cascades, which
 * are what current installs produce, are all `.db`-backed.
 *
 * Generator and step usage are merged by provider identity, not added.
 * Output includes thinking in the wire format; the decoder splits it once.
 * Cache-write TTL is unknown and stays in the unspecialized write counter.
 */

// Normalize legacy responseModel slugs to canonical names. Only used when a
// .db record lacks modelDisplayName; display names are used verbatim (they
// carry the reasoning tier, e.g. "Gemini 3.5 Flash (High)").
const MODEL_NORMALIZE_MAP = {
  'claude-opus-4-6-thinking': 'claude-opus-4-6',
  'claude-sonnet-4-6-thinking': 'claude-sonnet-4-6',
  'gemini-3.1-pro-high': 'gemini-3.1-pro',
  'gemini-3.1-pro-low': 'gemini-3.1-pro',
  'gemini-3-pro-high': 'gemini-3-pro',
  'gemini-3-pro-low': 'gemini-3-pro',
};

// Display names ("Gemini 3.5 Flash (High)", "Claude Opus 4.6 (Thinking)")
// are normalized to slug form so server pricing can match them; the reasoning
// tier in parentheses is dropped (tiers share the same list price).
const DISPLAY_NAME_MAP = {
  'claude opus 4.6': 'claude-opus-4-6',
  'claude opus 4.5': 'claude-opus-4-5',
  'claude sonnet 4.6': 'claude-sonnet-4-6',
  'gemini 3.7 flash': 'gemini-3.7-flash',
  'gemini 3.5 flash': 'gemini-3.5-flash',
  'gemini 3 flash': 'gemini-3-flash',
  'gemini 3.7 pro': 'gemini-3.7-pro',
  'gemini 3.5 pro': 'gemini-3.5-pro',
  'gemini 3.1 pro': 'gemini-3.1-pro',
};

// Known provider-published IDs only; an unfamiliar ID stays unknown rather
// than inheriting a model from another call or acquiring an invented price.
const MODEL_ID_NAMES = {
  246: 'gemini-2.5-pro', 312: 'gemini-2.5-flash', 313: 'gemini-2.5-flash-thinking',
  329: 'gemini-2.5-flash-thinking', 330: 'gemini-2.5-flash-lite',
  281: 'claude-4-sonnet', 282: 'claude-4-sonnet', 290: 'claude-4-opus', 291: 'claude-4-opus',
  333: 'claude-4.5-sonnet', 334: 'claude-4.5-sonnet', 340: 'claude-4.5-haiku', 341: 'claude-4.5-haiku',
  342: 'gpt-oss-120b-medium', 1071: 'gemini-3.6-flash-high', 1072: 'gemini-3.6-flash-medium',
  1073: 'gemini-3.6-flash-low', 1298: 'gemini-3.7-flash-high', 1299: 'gemini-3.7-flash-medium',
  1300: 'gemini-3.7-flash-low', 1318: 'gemini-3.8-flash-high', 1319: 'gemini-3.8-flash-medium',
  1320: 'gemini-3.8-flash-low',
};

function slugFromDisplayName(name) {
  const base = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  return DISPLAY_NAME_MAP[base] || base.replace(/\s+/g, '-');
}

function modelFromRecord(record) {
  if (record.displayName) return slugFromDisplayName(record.displayName);
  if (record.responseModel) return MODEL_NORMALIZE_MAP[record.responseModel]
    || (/\s/.test(record.responseModel) ? slugFromDisplayName(record.responseModel) : record.responseModel);
  if (record.modelId && MODEL_ID_NAMES[record.modelId]) return MODEL_ID_NAMES[record.modelId];
  return 'unknown';
}

function reasoningEffortFromRecord(record) {
  const parenthetical = String(record.displayName || '').match(/\(([^)]+)\)\s*$/)?.[1];
  if (parenthetical) {
    const value = parenthetical.trim().toLowerCase();
    if (/^(low|medium|high|max)$/.test(value)) return value;
    if (value === 'thinking') return 'enabled';
  }
  const suffix = String(record.responseModel || '').match(/-(low|medium|high|max)$/i)?.[1];
  return suffix ? suffix.toLowerCase() : '';
}

function projectFromUri(uri) {
  if (!uri) return null;
  const parts = uri.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || null;
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function usageKeys(record, cascadeId) {
  return [record.responseId && `response:${record.responseId}`,
    record.providerMessageId && `provider:${record.providerMessageId}`,
    record.messageId && `message:${cascadeId}:${record.messageId}`].filter(Boolean);
}

function richerRecord(a, b) {
  const score = r => r.inputTokens + r.totalOutputTokens + r.cacheReadTokens + r.cacheCreationTokens;
  const [rich, poor] = score(b) > score(a) ? [b, a] : [a, b];
  return { ...rich, timestamp: rich.timestamp || poor.timestamp, modelId: rich.modelId || poor.modelId,
    displayName: rich.displayName || poor.displayName, responseModel: rich.responseModel || poor.responseModel };
}

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
function resolveConversationsDirs(sourceOptions = {}) {
  const override = process.env.KBU_USAGE_ANTIGRAVITY_DIR?.trim();
  return [...new Set([
    ...(override ? [override] : [
      join(homedir(), '.gemini', 'antigravity', 'conversations'),
      join(homedir(), '.gemini', 'antigravity-cli', 'conversations'),
      join(homedir(), '.gemini', 'antigravity-ide', 'conversations'),
    ]),
    ...configuredExtraRoots(sourceOptions, 'antigravity').flatMap(antigravityConversationDirs),
  ])];
}

export function roots({ sourceOptions } = {}) {
  return resolveConversationsDirs(sourceOptions).filter((dir) => existsSync(dir));
}

export async function parse({ sessionSalt, sourceOptions } = {}) {
  const dirs = roots({ sourceOptions });
  if (dirs.length === 0) return null;

  const entries = [];
  const sessionEvents = [];
  const groups = new Set();
  const byIdentity = new Map();
  const warnings = new Set();
  const merge = (record, cascadeId, project) => {
    if (!hasTokenUsage(record)) return;
    const keys = usageKeys(record, cascadeId);
    const hits = [...new Set(keys.map(key => byIdentity.get(key)).filter(Boolean))];
    const target = hits.shift() || { record: { ...record, project }, keys: new Set() };
    groups.add(target);
    for (const other of hits) {
      target.record = richerRecord(target.record, other.record);
      for (const key of other.keys) { target.keys.add(key); byIdentity.set(key, target); }
      groups.delete(other);
    }
    target.record = richerRecord(target.record, { ...record, project });
    for (const key of keys) { target.keys.add(key); byIdentity.set(key, target); }
  };

  for (const dir of dirs) {
    for (const cascadeId of listDbCascades(dir)) {
      const steps = readDbStepRows(dir, cascadeId);
      const records = readDbUsageRecords(dir, cascadeId);
      const project = projectFromUri(readDbWorkspaceUri(dir, cascadeId)) || 'unknown';
      for (const record of records) {
        // Exact index join only. A nearby step may belong to a different day.
        const timestamp = record.timestamp || steps.timestamps.get(record.lastStepIndex ?? record.idx) || null;
        merge({ ...record, timestamp }, cascadeId, project);
        for (const retry of record.retryUsages) {
          if (hasTokenUsage(retry) && !usageKeys(retry, cascadeId).length && hasTokenUsage(record)) {
            warnings.add('antigravity: retry usage without identity omitted to avoid double counting. / 缺少身份的重试用量已跳过。');
          } else merge({ ...retry, timestamp, displayName: record.displayName, responseModel: record.responseModel }, cascadeId, project);
        }
      }
      for (const row of steps.usages) {
        for (const usage of [row.usage, ...row.retryUsages].filter(hasTokenUsage)) {
          if (!usageKeys(usage, cascadeId).length && (records.length || usage !== row.usage && hasTokenUsage(row.usage))) {
            warnings.add('antigravity: overlapping step usage without identity omitted to avoid double counting. / 缺少身份的重叠用量已跳过。');
            continue;
          }
          merge({ ...usage, modelId: usage.modelId || row.modelId, timestamp: row.timestamp,
            displayName: /\s/.test(row.modelName) ? row.modelName : '', responseModel: row.modelName }, cascadeId, project);
        }
      }

      for (const event of steps.events) {
        sessionEvents.push({ sessionId: cascadeId, source: 'antigravity', project,
          timestamp: event.timestamp, role: event.role });
      }
    }
  }
  for (const { record } of groups) {
    if (!record.timestamp || !Number.isFinite(+record.timestamp)) {
      warnings.add('antigravity: usage without an exact timestamp omitted; scan is partial. / 缺少准确时间的用量未计入，扫描不完整。');
      continue;
    }
    const reasoningEffort = reasoningEffortFromRecord(record);
    entries.push({
          source: 'antigravity',
          model: modelFromRecord(record),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          project: record.project,
          timestamp: record.timestamp,
          inputTokens: tokenCount(record.inputTokens),
          cacheWriteInputTokens: tokenCount(record.cacheCreationTokens),
          cacheReadInputTokens: tokenCount(record.cacheReadTokens),
          outputTokens: tokenCount(record.outputTokens),
          reasoningOutputTokens: tokenCount(record.thinkingOutputTokens),
    });
  }

  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(sessionEvents, sessionSalt),
    ...(warnings.size ? { skipped: true, warnings: [...warnings] } : {}),
  };
}
