# Kimi Builders Usage 0.6.1

> [中文](./RELEASE_NOTES_0.6.1.md)

## Local scanning

- Added Qoder, Qoder CN, and DeepSeek Harness (DSH) as Beta sources. Added the
  Antigravity standalone IDE location and report database read errors instead
  of treating them as successful empty scans.
- Qoder deduplicates physical and overlapping copies by session, role, and message
  ID. Conflicting copies retain one complete observation and report partial status;
  counts are never added or assembled from per-field maxima. Records without a
  message ID/UUID cannot be proven duplicates and remain independent. Credits are
  not converted to Tokens, and unknown routing tiers remain unpriced.
- Qoder discovers and parses files incrementally without retaining a full path
  list. Budgets: depth 16, 2048 directories, 50000 entries, 10000 JSONL files,
  256 MiB total read, and 64 MiB per file. Exceeding a budget reports partial status,
  retains prior sync checkpoints, and asks for a narrower data location.
- DSH supports V0–V3, multi-frame Zstd, and inherited-session deduplication. Corrupt
  middle records, invalid record shapes, and unfinished final records retain readable
  facts but report partial status, protecting missing-record checkpoints. An
  `exact` measurement describes observed Token counters, not complete scan coverage.
  Compressed logs require Node ≥22.15 with built-in Zstd or a local `zstd` binary;
  no decompression tool is installed automatically.

## Sync experience and background runtime

- CLI / Dashboard show batch acknowledgements, measured ETA, retry waits, and
  acknowledged compressed bytes. Failure, partial completion, and success remain
  distinct and persistent; detailed diagnostics stay in private local logs.
- Connected users see manual/background sync before the collapsible source list.
  Summaries use saved permissions; unsaved changes block manual sync and show a
  reminder instead of presenting drafts as active upload permissions.
- Bound community identity is verified through an authorized read-only endpoint.
  Older or offline communities show an unconfirmed state without blocking local analysis.
- Background sync uses a local copy of the current fixed version, independent of
  npx cache cleanup and without unattended `@latest` downloads. The system Node
  executable must remain installed; changing the background version is explicit.

## Upgrade and rollout order

Maintainers must deploy the three community source IDs and
`GET /api/usage/device/current` before publishing this CLI. New sources remain
Beta and never silently join sync on devices with explicit source policies.

```bash
npx @kimi.builders/usage@latest dashboard
```

For an existing background installation, choose “Update to this version” in the
Dashboard or run:

```bash
npx @kimi.builders/usage@latest daemon restart
```

Upgrading does not delete local history, community connections, provider credentials,
or remote data. No database migration is required.

## Pre-release review corrections

- Count Gemini candidate output separately from thoughts; remove duplicate subtraction.
- Isolate damaged Pi, WorkBuddy, and ZCode records with partial-scan diagnostics; accept migrated Windows project paths in ZCode.
- Retain both partial endpoint hours in rolling 24H charts; omit efficiency ratios when model, project, effort, or agent-version filters cannot match activity scope.
- Derive measurement confidence from `measurement`, separately from pricing assumptions; exclude unknown attribution values.
- Store budgets and preferences locally across dashboard ports, with explicit save-failure feedback.
- Probe local credentials only after explicit login detection; document reading logs, extracting fields, and discarding conversation text.
- Local JSON `factSchemaVersion: 2` adds cache TTL counters, session hour slices, and independent salted identifiers; community protocol remains v2.
- Reuse first-scan results when scope is unchanged. Preserve allowlisted source-location environment variables in daemon descriptors and reject control characters.
- Bundle complete third-party license texts and reject missing or stale texts in the package audit.

- Large histories: stream Kimi, Pi, and Gemini JSONL with bounded records; retain only needed Codex context fields and discard duplicate copies early. A full scan still reads history; checkpoints deduplicate sync and are not file-offset caches.
