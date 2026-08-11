# Privacy

`@kimi-builders/usage` is local-first. Reading and analysing local Agent logs does
not require a Kimi Builders account and does not require network access.

## Data boundaries

| Boundary | What exists there | Default |
| --- | --- | --- |
| Local source logs | Provider-owned conversation and usage files | Read-only |
| Local snapshot | Aggregated token buckets, session timing, local project basename | Memory only |
| Sync payload | Protocol-v2 aggregates and diagnostic client metadata | Explicit `sync` only |
| Public community | Period aggregates selected by the account owner | Off |

The local snapshot may contain project basenames because they are useful for
private analysis. A project basename is removed from the sync payload unless the
user enables project upload in community settings.

## Never uploaded

- prompts, responses, reasoning text, or tool results;
- full filesystem paths, repository remotes, or file contents;
- raw session IDs;
- provider credentials, cookies, API keys, or environment dumps;
- local dashboard queries or navigation events.

Session IDs are transformed with HMAC-SHA-256 and a random installation-local
salt. Different installations cannot correlate the resulting hashes.

## Uploaded by `sync`

The complete transport contract is documented in
[`docs/LOCAL_SNAPSHOT_V1.md`](docs/LOCAL_SNAPSHOT_V1.md). The principal fields
are source, model facts recorded by the Agent, 30-minute UTC time, exclusive
token counters, request counts, measurement quality, salted session hash,
session timing/message counters, and client/Agent versions used for diagnostics.

`init`, `sync`, and `summary` are the only commands that contact a configured
Kimi Builders origin. See [`NETWORK.md`](NETWORK.md) for the endpoint inventory.

## Public visibility

Syncing data is not the same as publishing it. Community leaderboard/profile
visibility is a separate, default-off account setting. Public surfaces use
period aggregates and must not expose project, device, session, or hourly-detail
dimensions.

## Local reports

`doctor --json` is designed for bug reports: it excludes roots, paths, projects,
model names, session hashes, and bucket timestamps. It still contains aggregate
counts and redacted parser errors, so review it before sharing. `inspect`, by
contrast, intentionally prints the local directories it is reading and should
not be shared without careful review.
