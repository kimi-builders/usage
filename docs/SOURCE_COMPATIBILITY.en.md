# Local usage source compatibility matrix

> [中文](./SOURCE_COMPATIBILITY.md)
>
> Last reviewed: 2026-08-15 · Collector `0.5.1`

This matrix describes the compatibility evidence available for each parser; it
is not an official support claim by any Agent vendor. Every source reads local
logs only, and one source failure does not block others. `doctor --json` creates
a redacted report without paths, project names, model names, session IDs, or
per-record timestamps.

Automatic discovery is not forced scanning or upload. The first-run wizard and
“Local & sources” screen let each source be Off, Local only, or Local + sync.
Only the last mode enters community sync. Newly supported automatic sources
default to Local only and never silently join an existing user's sync set.

## Maturity definitions

| Level | Meaning |
| --- | --- |
| Core | Primary project source with broad regression coverage for current and legacy formats, malformed input, and aggregation rules |
| Stable | Frozen fixture, failure boundaries, and real-sample verification; the upstream log schema is still not guaranteed |
| Beta | Scanning and dedicated tests exist, but version, platform, or historical-format evidence remains limited |
| Explicit opt-in | Never read automatically; the user must provide an import file or configuration |

## 0.5.x matrix

| Source | Level | Auto-discovered | Main evidence | Known boundary |
| --- | --- | --- | --- | --- |
| Kimi Code | Core | Yes | Current/legacy stores, deltas, cache, sub-agents, second timestamps, malformed records | New upstream fields are used only when their meaning can be proven |
| Claude Code | Stable | Yes | Projects/transcripts, cache TTL, duplicate UUID, sidechain, malformed JSONL | Claude Desktop/Cowork paths are compatibility reads whose format remains upstream-controlled |
| Codex | Stable | Yes | Current/archived sessions, streaming huge JSONL, replay deduplication, reasoning effort, context/processing tier, sub-agents | Events without usage never produce guessed Tokens |
| OpenCode | Stable | Yes | SQLite, legacy JSON, Token mapping, malformed records | SQLite schema drift is isolated as a source failure |
| Gemini CLI | Stable | Yes | JSONL, legacy JSON, nested sub-agents, malformed records | Reads only existing usage metadata; never estimates from text |
| Antigravity | Stable | Yes | App/CLI offline databases, model and Token mapping | Locked or changed databases may be partially readable |
| GitHub Copilot CLI | Stable | Yes | Session discovery, mutually exclusive cache/input classification | Some versions retain sessions without usable Token counts |
| Roo Code | Stable | Yes | VS Code task history, cache fields, time events | Covers only task data still retained locally |
| Pi Coding Agent | Beta | Yes | JSONL sessions, Token classification, empty/malformed records | Version matrix and cross-directory copy deduplication evidence are still expanding |
| ZCode | Beta | Yes | Valid/empty/malformed SQLite, project and provider mapping | Node 20 needs system `sqlite3` without `node:sqlite`; real Windows evidence is limited |
| WorkBuddy / CodeBuddy | Beta | Yes | JSONL project store, routed models, exclusive Tokens, session deduplication | Product-version and historical-format samples are limited; the UI uses CodeBuddy branding |
| Cursor | Dashboard-validated CSV or explicit CLI opt-in | No | Official Usage CSV references, Token categories, quoted fields | Supports user-exported CSV only; does not read editor conversations or private databases |

## Platforms and Node.js

- Node.js 20 and newer are supported.
- CI runs Collector and Provider contract tests on Ubuntu Node 20/22/24 and on
  macOS and Windows Node 22/24.
- Passing platform CI proves code paths run; it does not provide a real log sample
  for every Agent version.
- ZCode's Node 20 SQLite fallback is Beta. If system `sqlite3` is absent, it skips
  or fails explicitly instead of reporting fabricated zero usage.

## Report a new format or missing data

1. Upgrade to the latest Collector and run `doctor --json`.
2. Run `inspect --dry-run` to verify discovery. It includes local paths, so do not
   publish the complete output.
3. Use the Parser compatibility issue template and include Agent version, OS,
   Node version, and the count discrepancy.
4. Do not upload complete JSONL/SQLite, prompts, responses, cookies, tokens,
   project paths, or raw session IDs.

Adding or upgrading a source requires updating this matrix, frozen fixtures,
privacy documentation, and any necessary NOTICE attribution.
