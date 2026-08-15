# Privacy

`@kimi.builders/usage` is local-first. Reading and analysing local Agent logs does
not require a Kimi Builders account and does not require network access.

## Data boundaries

| Boundary | What exists there | Default |
| --- | --- | --- |
| Local source logs | Provider-owned conversation and usage files | Read-only |
| Local snapshot | Aggregated token buckets, session timing, local project basename | Memory only |
| Local source policy | Per-Agent Off / Local / Local + sync selection | Owner-only config file |
| Sync payload | Protocol-v2 aggregates and diagnostic client metadata | Explicit `sync`, or an explicitly installed background schedule |
| Public community | Period aggregates selected by the account owner | Off |
| Provider quota check | Account limit/reset metadata for enabled providers | Off |
| Local quota history | Sanitized quota percentages and reset windows | Only after an enabled provider is refreshed |

The local snapshot contains only sources the user leaves in Local or Local +
sync mode. Off sources are not parsed. The snapshot may contain project basenames because they are useful for
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

Successful subscription-limit refreshes keep a separate local history file at
`~/.kimi-builders/usage/subscription-history.json` (or the configured Collector
directory). It contains only observation time, provider ID/label/plan, quota
window ID/label, used/remaining percentages, reset time, window duration, and
provider-reported numeric limit/unit fields. It deliberately excludes account
identity, credential/source paths, errors, raw provider responses, and local
Token records. The file is written with owner-only permissions where supported.
Observations are retained for at most 400 days and compacted to 15-minute,
hourly, then daily resolution as they age. Deleting this file resets only quota
history; it does not revoke provider logins or delete Agent usage logs.

Session IDs are transformed with HMAC-SHA-256 and a random installation-local
salt. Different installations cannot correlate the resulting hashes.

## Uploaded by `sync`

The complete transport contract is documented in
[`docs/LOCAL_SNAPSHOT_V1.md`](docs/LOCAL_SNAPSHOT_V1.md). The principal fields
are source, model facts recorded by the Agent, 30-minute UTC time, exclusive
token counters, request counts, measurement quality, salted session hash,
session timing/message counters, and client/Agent versions used for diagnostics.

`init`, `sync`, scheduled `daemon run`, `summary`, and explicit community actions
inside the loopback Dashboard are the only operations that contact a configured
Kimi Builders origin. `init` connects only and does not upload unless `--sync` is
also supplied. Installing, inspecting, restarting, or removing the scheduler is
local; install/restart may immediately trigger its first run. The local dashboard can separately contact a provider only
after its subscription-limit integration is enabled. See [`NETWORK.md`](NETWORK.md)
for the endpoint inventory.

Quota history and the Token correlation/decision calculations derived from it
stay local. They are not included in CSV/JSON usage exports, share posters, or
community sync.

## Public visibility

Syncing data is not the same as publishing it. Community leaderboard/profile
visibility is a separate, default-off account setting. Public surfaces use
period aggregates and must not expose project, device, session, or hourly-detail
dimensions.

Per-Agent source policy belongs to the current device. Changing Local + sync to
Local or Off stops future uploads from that source but does not silently delete
existing cloud history. The Dashboard offers a separate confirmed action to
delete all cloud usage belonging to the current device; account-level public
visibility remains managed by the community account.

## Local reports

`doctor --json` is designed for bug reports: it excludes roots, paths, projects,
model names, session hashes, and bucket timestamps. It still contains aggregate
counts and redacted parser errors, so review it before sharing. `inspect`, by
contrast, intentionally prints the local directories it is reading and should
not be shared without careful review.
