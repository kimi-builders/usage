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
| Provider quota check | Account limit/reset metadata for enabled providers | Off |

The local snapshot may contain project basenames because they are useful for
private analysis. A project basename is removed from the sync payload unless the
user enables project upload in community settings.

## Never uploaded

- prompts, responses, reasoning text, or tool results;
- full filesystem paths, repository remotes, or file contents;
- raw session IDs;
- provider credentials, cookies, API keys, or environment dumps;
- local dashboard queries or navigation events.

Provider access tokens are used only inside the loopback dashboard server when
the owner enables subscription-limit checks. Auto-detected tokens are read from
the provider's own local login store. Manual secrets use macOS Keychain when
available; the normal Collector config stores only provider toggles, auth mode,
environment-variable names, optional IDE paths, a Qoder site choice, and an
optional OpenCode workspace identifier/link. Raw tokens, cookies, and copied
cURL fragments are never returned to the browser, included in exports, or added
to community sync. Local account detection reads only the minimum credential or
quota-store field required to report whether a supported app is signed in; it
does not read conversation content. Windsurf detection and quota display read
only the `windsurf.settings.cachedPlanInfo` record from its local state database.

Session IDs are transformed with HMAC-SHA-256 and a random installation-local
salt. Different installations cannot correlate the resulting hashes.

## Uploaded by `sync`

The complete transport contract is documented in
[`docs/LOCAL_SNAPSHOT_V1.md`](docs/LOCAL_SNAPSHOT_V1.md). The principal fields
are source, model facts recorded by the Agent, 30-minute UTC time, exclusive
token counters, request counts, measurement quality, salted session hash,
session timing/message counters, and client/Agent versions used for diagnostics.

`init`, `sync`, and `summary` are the only commands that contact a configured
Kimi Builders origin. The local dashboard can separately contact a provider only
after its subscription-limit integration is enabled. See [`NETWORK.md`](NETWORK.md)
for the endpoint inventory.

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
