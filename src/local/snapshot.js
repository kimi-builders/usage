import { homedir } from 'node:os';
import { createSessionSalt, loadConfig } from '../config.js';
import { enabledSources } from '../parsers/index.js';
import { sourceIdsFor } from '../source-policy.js';
import { validateUploadBucket, validateUploadSession } from '../protocol.js';
import { summarizeBySource, summarizeUsage } from './metrics.js';

export const LOCAL_SNAPSHOT_SCHEMA_VERSION = 1;

function message(error) {
  return error?.message || String(error);
}

function redactLocalPaths(value, roots = []) {
  let output = String(value || '');
  const known = [homedir(), ...roots]
    .filter((path) => typeof path === 'string' && path.length > 1)
    .sort((left, right) => right.length - left.length);
  for (const path of known) output = output.split(path).join('<local-path>');
  return output
    .replace(/(?:file:\/\/)?\/(?:[^/\s:'"()[\]{}]+\/)+[^/\s:'"()[\]{}]*/g, '<local-path>')
    .replace(/\b[A-Za-z]:\\(?:[^\\\s:'"()[\]{}]+\\)+[^\\\s:'"()[\]{}]*/g, '<local-path>');
}

// This module deliberately has no dependency on api.js. It is the shared,
// network-free read boundary for the CLI, the future local web dashboard, and
// desktop shells. Injecting sourceEntries also keeps parser contract tests from
// ever touching the developer's real HOME.
export async function collectAll({
  sessionSalt,
  enabledSourceIds = [],
  sourceIds,
  sourceOptions = {},
  sourceEntries,
} = {}) {
  const results = [];
  const requested = Array.isArray(sourceIds) ? new Set(sourceIds) : null;
  const sources = (sourceEntries || enabledSources(enabledSourceIds))
    .filter((source) => !requested || requested.has(source.id));
  for (const source of sources) {
    let roots = [];
    try {
      roots = (await source.roots({ sourceOptions })) || [];
      if (roots.length === 0) {
        results.push({
          source: source.id,
          tier: source.tier,
          status: 'skipped',
          roots: [],
          buckets: [],
          sessions: [],
        });
        continue;
      }
      const parsed = await source.parse({ sessionSalt, sourceOptions });
      results.push({
        source: source.id,
        tier: source.tier,
        status: parsed?.skipped ? 'partial' : 'ok',
        roots,
        buckets: parsed?.buckets ?? [],
        sessions: parsed?.sessions ?? [],
        ...(parsed?.warnings?.length ? { warnings: parsed.warnings } : {}),
      });
    } catch (error) {
      results.push({
        source: source.id,
        tier: source.tier,
        status: 'failed',
        roots,
        buckets: [],
        sessions: [],
        error: message(error),
      });
    }
  }
  return {
    results,
    buckets: results.flatMap((result) => result.buckets),
    sessions: results.flatMap((result) => result.sessions),
  };
}

function validateCollected(collected) {
  const buckets = [];
  const sessions = [];
  const rejected = [];
  for (const bucket of collected.buckets) {
    const error = validateUploadBucket(bucket);
    if (error) rejected.push({ kind: 'bucket', source: bucket.source, error });
    else buckets.push(bucket);
  }
  for (const session of collected.sessions) {
    const error = validateUploadSession(session);
    if (error) rejected.push({ kind: 'session', source: session.source, error });
    else sessions.push(session);
  }
  return { buckets, sessions, rejected };
}

export async function collectLocalSnapshot({
  config = loadConfig(),
  sessionSalt,
  sourceEntries,
  generatedAt = new Date(),
} = {}) {
  const stableIdentity = Boolean(sessionSalt || config?.sessionSalt);
  const salt = sessionSalt || config?.sessionSalt || createSessionSalt();
  const collected = await collectAll({
    sessionSalt: salt,
    enabledSourceIds: config?.enabledSources,
    sourceIds: sourceIdsFor(config, 'scan', sourceEntries || undefined),
    sourceOptions: config?.sourceOptions,
    sourceEntries,
  });
  const accepted = validateCollected(collected);
  const data = { buckets: accepted.buckets, sessions: accepted.sessions };
  const sources = collected.results.map((result) => ({
    source: result.source,
    tier: result.tier,
    status: result.status,
    roots: result.roots,
    bucketCount: result.buckets.length,
    sessionCount: result.sessions.length,
    ...(result.warnings ? { warnings: result.warnings } : {}),
    ...(result.error ? { error: result.error } : {}),
  }));

  return {
    schemaVersion: LOCAL_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    locality: {
      mode: 'local-only',
      networkRequests: 0,
      sessionIdentity: stableIdentity ? 'installation-stable' : 'ephemeral',
    },
    sources,
    summary: summarizeUsage(data),
    sourceSummaries: summarizeBySource(data),
    diagnostics: {
      parsedBuckets: collected.buckets.length,
      parsedSessions: collected.sessions.length,
      acceptedBuckets: accepted.buckets.length,
      acceptedSessions: accepted.sessions.length,
      rejected: accepted.rejected,
    },
    data,
  };
}

// Redacted for terminal/bug-report output: no paths, project names, model names,
// session hashes, or bucket timestamps leave the in-memory local snapshot. The
// caller must still tell users that aggregate counts remain in the report.
export function publicDoctorReport(snapshot) {
  const { firstActivityAt, lastActivityAt, ...summary } = snapshot.summary;
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    locality: snapshot.locality,
    sources: snapshot.sources.map((source) => ({
      source: source.source,
      tier: source.tier,
      status: source.status,
      rootCount: source.roots.length,
      bucketCount: source.bucketCount,
      sessionCount: source.sessionCount,
      warningCount: source.warnings?.length || 0,
      ...(source.error ? { error: redactLocalPaths(source.error, source.roots) } : {}),
    })),
    summary,
    diagnostics: {
      ...snapshot.diagnostics,
      rejected: snapshot.diagnostics.rejected.map(({ kind, source, error }) => ({
        kind,
        source,
        error: redactLocalPaths(error),
      })),
    },
  };
}
