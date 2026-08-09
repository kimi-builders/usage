import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateToBuckets, extractSessions } from './index.js';
import {
  listDbCascades,
  readDbSessionEvents,
  readDbUsageRecords,
  readDbWorkspaceUri,
} from './antigravity-db.js';

/**
 * Antigravity parser (Google Antigravity IDE + `agy` CLI).
 *
 * Conversation stores scanned:
 *   ~/.gemini/antigravity/conversations/*.db        (App 2.0)
 *   ~/.gemini/antigravity-cli/conversations/*.db    (agy CLI)
 * KBU_USAGE_ANTIGRAVITY_DIR overrides both with a single conversations dir.
 *
 * Only the offline SQLite path is ported: each cascade is a per-conversation
 * `.db` of plain-protobuf blobs (see antigravity-db.js). The legacy `.pb`
 * store — encrypted, decodable only through a running language server's
 * GetCascadeTrajectory RPC — is intentionally NOT read (process discovery +
 * RPC is out of scope for a local collector); App 2.0 / CLI cascades, which
 * are what current installs produce, are all `.db`-backed.
 *
 * Token mapping: gen_metadata usage fields are already exclusive counts —
 * inputTokens / outputTokens / cacheReadTokens → cacheReadInputTokens /
 * thinkingOutputTokens → reasoningOutputTokens; no cache-write field exists.
 * Usage rows dedup by responseId across cascades (the same response can be
 * recorded under both the App and the CLI store).
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
  'gemini 3.5 flash': 'gemini-3.5-flash',
  'gemini 3 flash': 'gemini-3-flash',
  'gemini 3.1 pro': 'gemini-3.1-pro',
};

function slugFromDisplayName(name) {
  const base = name.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  return DISPLAY_NAME_MAP[base] || base.replace(/\s+/g, '-');
}

function modelFromRecord(record) {
  if (record.displayName) return slugFromDisplayName(record.displayName);
  if (record.responseModel) return MODEL_NORMALIZE_MAP[record.responseModel] || record.responseModel;
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

// Resolved lazily (not at import time) so importing the registry never
// touches the filesystem — tests point the override at fixtures before use.
function resolveConversationsDirs() {
  const override = process.env.KBU_USAGE_ANTIGRAVITY_DIR?.trim();
  if (override) return [override];
  return [
    join(homedir(), '.gemini', 'antigravity', 'conversations'),
    join(homedir(), '.gemini', 'antigravity-cli', 'conversations'),
  ];
}

export function roots() {
  return resolveConversationsDirs().filter((dir) => existsSync(dir));
}

export async function parse({ sessionSalt } = {}) {
  const dirs = roots();
  if (dirs.length === 0) return null;

  const entries = [];
  const sessionEvents = [];
  const seenResponseIds = new Set();

  for (const dir of dirs) {
    for (const cascadeId of listDbCascades(dir)) {
      const records = readDbUsageRecords(dir, cascadeId);
      const project = projectFromUri(readDbWorkspaceUri(dir, cascadeId)) || 'unknown';

      for (const record of records) {
        if (record.responseId && seenResponseIds.has(record.responseId)) continue;
        if (record.responseId) seenResponseIds.add(record.responseId);
        // Invalid/missing timestamp → skip the record entirely; never stamp
        // "now" (a stateless parser would re-key it on every sync).
        if (!record.timestamp || isNaN(record.timestamp.getTime())) continue;
        const reasoningEffort = reasoningEffortFromRecord(record);
        entries.push({
          source: 'antigravity',
          model: modelFromRecord(record),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          project,
          timestamp: record.timestamp,
          inputTokens: tokenCount(record.inputTokens),
          cacheWriteInputTokens: 0,
          cacheReadInputTokens: tokenCount(record.cacheReadTokens),
          outputTokens: tokenCount(record.outputTokens),
          reasoningOutputTokens: tokenCount(record.thinkingOutputTokens),
        });
      }

      // Session timing comes from the steps table, independent of whether the
      // cascade has any token usage rows.
      for (const event of readDbSessionEvents(dir, cascadeId)) {
        sessionEvents.push({
          sessionId: cascadeId,
          source: 'antigravity',
          project,
          timestamp: event.timestamp,
          role: event.role,
        });
      }
    }
  }

  return {
    buckets: aggregateToBuckets(entries),
    sessions: extractSessions(sessionEvents, sessionSalt),
  };
}
