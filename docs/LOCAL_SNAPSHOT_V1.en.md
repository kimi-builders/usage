# Local snapshot v1: data and calculation contract

> [中文](./LOCAL_SNAPSHOT_V1.md)
>
> Status: implemented and covered by automated tests. Last reviewed against `0.5.1`.

The local snapshot is the stable read boundary between parsers, the CLI, the local
web dashboard, and community sync. Its implementation starts at
`src/local/snapshot.js`; metric aggregation lives in `src/local/metrics.js`; and
the second validation before upload lives in `src/protocol.js`.

It is not a persisted conversation database. Every scan read-only regenerates a
snapshot from known Agent stores, and the result primarily stays in process memory.
Incremental community sync separately stores content hashes in `state.json`; those
hashes answer only whether an aggregate record changed. They do not store prompts,
responses, or a complete history copy.

## 1. Data flow

```text
Agent local logs / SQLite / user-exported CSV
                    │ read-only
                    ▼
          independent source parser
                    │
                    ├─ raw usage events
                    └─ raw session events
                    ▼
       30-minute buckets + redacted sessions/activity
                    │
                    ├─ local validation ── isolate invalid records
                    ▼
              Local Snapshot v1
              │                │
              ▼                ▼
       local pricing/analysis  privacy trim + incremental sync
              │                │
              ▼                ▼
       127.0.0.1 dashboard    kimi.builders API
```

Parser modules do not depend on the network client. Creating a local snapshot
never contacts the community or queries subscription limits. The quota service has
its own data, credentials, and network boundary and is not part of this snapshot.

## 2. Top-level structure

```text
schemaVersion    always 1
generatedAt      scan completion time (ISO 8601)
locality         locality, network request count, session-identity explanation
sources          status, roots, and diagnostics for every source
summary          all-source aggregate
sourceSummaries  per-source aggregate
diagnostics      parsed, accepted, and rejected counts
data
  buckets        30-minute Token buckets
  sessions       redacted sessions and sparse hourly activity
```

The local dashboard uses `createDashboardData()` to produce a separate browser-safe
view. It removes source roots and session hashes, then adds price matches, device
facts, and aggregated `activityHours`. Browser data, the raw snapshot, and the
community upload protocol are therefore three distinct layers.

## 3. Token bucket

Every bucket aligns to a UTC 30-minute boundary. Its aggregation key includes source,
raw model, model provider, reasoning effort, Agent version, context tier, processing
tier, project basename, and time; different request facts within the same interval
are not incorrectly collapsed.

| Field | Required | Meaning |
| --- | --- | --- |
| `source` | Yes | Agent source ID |
| `model` | Yes | Raw model name recorded by the Agent; normalization never removes it |
| `modelCanonical` | No | Canonical model name when mapping is reliable |
| `modelProvider` | No | Model provider when evidence is reliable |
| `reasoningEffort` | No | Reasoning effort explicitly recorded by the request; current settings never backfill history |
| `agentVersion` | No | Agent version explicitly recorded by the request; current version never backfills history |
| `contextTier` | No | `short` / `long`, only when the context tier can be established |
| `processingTier` | No | `standard` / `batch` / `flex` / `priority` |
| `project` | No | Local project-directory basename; omitted from sync by default |
| `bucketStart` | Yes | UTC 30-minute boundary |
| `inputTokens` | Yes | Fresh input Tokens |
| `cacheWriteInputTokens` | Yes | Cache-write Tokens |
| `cacheWrite5mInputTokens` | No | Five-minute cache-write partition when distinguishable |
| `cacheWrite1hInputTokens` | No | One-hour cache-write partition when distinguishable |
| `cacheReadInputTokens` | Yes | Cache-read Tokens |
| `outputTokens` | Yes | Non-reasoning output Tokens |
| `reasoningOutputTokens` | Yes | Reasoning output Tokens when separable |
| `requestCount` | Yes | Request count inside the bucket |
| `creditUnits` | No | Value for a source that exposes credits only |
| `measurement` | Yes | `exact`, `estimated`, or `credit` |

### Token overlap

When the source exposes enough detail, the five primary Token categories are exclusive:

```text
Total Tokens = input + cache write + cache read + output + reasoning output
```

- Tokens identified as cache reads are removed from `inputTokens`.
- Tokens identified as reasoning are removed from `outputTokens`.
- `cacheWrite5mInputTokens + cacheWrite1hInputTokens` cannot exceed total cache write.
- For cumulative-only sources, parsers use delta/reset rules. If safe separation
  is impossible, the measurement is `estimated`; precision is never fabricated.
- Unpriced is not $0: Tokens remain in all quantity metrics and are marked unpriced
  in cost coverage.

### Model identity

Raw `model` is a fact; `modelCanonical` is an interpretation layer. Normalization
applies only to evidenced aliases, such as Kimi product names mapped to concrete
model families. Ambiguous cross-provider names remain raw. Pricing prefers the
canonical model while preserving the raw value for diagnostics and future repricing.

## 4. Sessions and time

Sessions contain no conversation body. Fields include source, optional project and
Agent version, salted ID, first/last message time, engaged time, active time, message
counts, user-message counts, the legacy 24-hour prompt histogram, and new sparse
hourly slices.

Raw session IDs use HMAC-SHA-256 with an installation-local random salt:

- stable within one installation for incremental updates;
- impossible to correlate across installations;
- when no persistent config exists, a temporary salt is used and
  `locality.sessionIdentity` is `ephemeral`.

### Two time definitions

```text
Active time
  identifiable work intervals between assistant/tool events
  each idle gap capped at 5 minutes

Engaged time (protocol field remains durationSeconds)
  in-turn timeline from user to assistant/tool
  each idle gap capped at 30 minutes
```

New `activityHours` are split by UTC calendar hour. Every slice contains:

- `activeSeconds`
- `engagedSeconds`
- `messageCount`
- `userMessageCount`

Intervals crossing an hour boundary are split. Each time value is at most 3,600
seconds per hour, and hourly totals must exactly match the session aggregate. This
allows accurate clipping for 24H, calendar days, natural weeks, and weekday × local
hour heatmaps. Prompts no longer all fall on the session's first day, and reused
long-lived IDs do not amplify offline time.

### Known limitations

- Most sources cannot reliably attribute session time to a model or reasoning
  effort; related filters never fabricate a split.
- `userPromptHours` is a legacy compatibility field. Serious date/hour analysis
  should use `activityHours`.
- When a source lacks roles or timed events, Tokens may be exact while session
  duration is absent.

## 5. Source status and failure policy

| Status | Meaning | Sync-checkpoint behavior |
| --- | --- | --- |
| `ok` | Parsed normally | May commit changes and remove records that disappeared |
| `partial` | Useful data exists with gaps | Upload useful records and retain previous source state |
| `skipped` | No local root was found | Do not parse; retain previous state |
| `failed` | Root found but parsing failed | Isolate the error; retain previous state |

Every parser fails independently. One format change cannot block another source or
cause a full replay after recovery.

Protocol validation rejects negative or unsafe integers, excessive counts, unknown
sources, misaligned time, out-of-bound sessions, duplicate hours, or inconsistent
slice totals. Rejection is per record; remaining valid data still enters the
dashboard or sync.

## 6. Cost is not a raw fact

`src/local/pricing.js` calculates cost in the local dashboard conversion layer:

```text
Estimated cost = Σ(Token category × standard API price effective at that time) ÷ 1,000,000
```

Matching includes model, source, effective interval, context tier, and processing
tier. Claude cache write can additionally use distinct five-minute and one-hour TTL
prices. The dashboard also returns:

- `pricedTokens`: explicitly covered by a price;
- `assumedTokens`: priced through a disclosed default assumption, such as unknown context tier;
- `unpricedTokens`: retained in quantity but excluded from cost.

This is a standard API equivalent estimate, not the user's subscription bill or
the provider's actual charge.

## 7. Local, uploaded, and public are separate boundaries

| Data | Local snapshot | Community sync | Public community |
| --- | --- | --- | --- |
| Token/request aggregates | Yes | Yes | Only permitted aggregates |
| Session time/counts | Yes | Salted | No record-level publication |
| Project basename | Yes | No by default; explicit opt-in | Must not be a public dimension |
| Source root | Diagnostic layer | No protocol field | No |
| Raw session ID | No | No | No |
| Prompt/response/tool result | No | No | No |
| Provider quota credentials/responses | Separate quota service | Never | Never |

Sync is not publication. Community profile, ranking, and work-association visibility
are separately controlled by the community account.

## 8. Compatibility and version policy

v1 may add optional fields that preserve all existing meaning. The following require
a `schemaVersion` increase:

- changing whether the five Token classes overlap;
- changing session time definitions;
- adding local-private fields to the upload boundary;
- changing field units, precision, or time basis;
- making old consumers interpret an existing field differently.

Every parser change should retain a minimal, redacted, frozen fixture and assert at
least totals, Token exclusivity, time, deduplication, model identity, malformed-record
handling, and root overrides. See [ROADMAP.en.md](./ROADMAP.en.md) for the parser
compatibility plan.

## 9. Implementations and checks

- `src/parsers/`: source parsers
- `src/parsers/index.js`: registry, bucket aggregation, session extraction
- `src/local/snapshot.js`: snapshot generation, source isolation, doctor report
- `src/local/metrics.js`: price-independent aggregation
- `src/local/dashboard-data.js`: browser-safe view and price matching
- `src/protocol.js`: upload protocol validation
- `src/state.js`: incremental checkpoints
- `test/*parser*.test.js`, source tests, and `test/consistency.test.js`: parser compatibility
- `test/local-snapshot.test.js`, `test/protocol.test.js`: contract boundaries
