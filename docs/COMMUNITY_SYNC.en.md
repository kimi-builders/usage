# Connecting and syncing with kimi.builders

[Back to the project](../README.en.md) · [简体中文](./COMMUNITY_SYNC.md)

kimi.builders is a separate web application. This guide is for users who choose
to send local usage aggregates to it. The local dashboard, CLI analytics, exports,
and subscription analysis work independently.

## Connect and sync the community (optional)

Connect the device once (or do the whole flow in the dashboard's “Sync data”
dialog):

```bash
npx @kimi.builders/usage init
```

The terminal shows a device code and opens the community approval page. After
approval, the device receives an independently revocable `kbu_` key. `init`
does not upload usage by itself; confirm source scope in the dashboard or with
`sources set`, then sync. Project upload is off by default; when disabled, the
JSON payload has no `project` field.

The connection code is valid for 10 minutes and lives only in the current
Collector/local-dashboard process; it is never written to browser storage or a
config file. Refreshing the dashboard can resume the request, while stopping or
restarting the process requires a new code. The device key is delivered once
after approval and can be safely revoked from the local dashboard at any time.

Each agent has three independent modes:

```bash
npx @kimi.builders/usage sources list
npx @kimi.builders/usage sources set codex off
npx @kimi.builders/usage sources set kimi-code local
npx @kimi.builders/usage sources set claude-code private
```

`off` does not scan, `local` stays in on-device analysis, and `private` may
upload to your community account. Changing mode never silently deletes existing
cloud history. Current-device cloud deletion is a separate confirmed dashboard
action. Newly supported agents default to local only and never join sync
automatically; account-level community settings separately control visibility.

Run one sync:

```bash
npx @kimi.builders/usage sync
```

Or install continuous per-user sync:

```bash
npx @kimi.builders/usage daemon install --interval 15
npx @kimi.builders/usage daemon status
npx @kimi.builders/usage daemon restart
npx @kimi.builders/usage daemon uninstall
```

The service needs no administrator privileges. It uses `launchd` on macOS,
user `systemd` on Linux, and Task Scheduler on Windows. It works only while the
device is awake and online. After upgrading the Collector, run `daemon restart`
to copy that version into a stable local runtime directory. Clearing the npx cache
does not remove that copy; background sync never automatically upgrades. Node
itself must remain installed.

The sync dialog shows the verified community account, acknowledged upload batches,
estimated remaining time, and retry waits. The CLI also reports batch progress.
Partial source failures persist as partial results with local diagnostics, without
advancing the last fully successful synchronization time.

Sync uses incremental checkpoints, per-source failure isolation, and a
concurrency lock. Repeated runs do not duplicate counts. If you delete a
device's remote history, reconnect as a different device, or the dashboard
cannot prove that the local checkpoint belongs to the current community
device, review every agent marked `private`, then explicitly replay it:

```bash
npx @kimi.builders/usage sync --full
```

`--full` re-uploads normalized aggregates only for `private` sources. It does
not include `off` or `local` sources and does not delete community data. The
checkpoint is bound to an irreversible fingerprint of the community target
and device credential, so a reconnect cannot silently inherit another
device's “already uploaded” state. The dashboard shows the same scope and asks
for a second confirmation.

`init` also attempts to download the public pricing catalog; use
`--skip-pricing-update` to skip that download. It contains no local usage.

Opening the dashboard and pressing “Rescan” do not upload usage. Uploads occur
only through `sync`, “Sync now”, background sync, or `init --sync`, and only for
sources marked “Local + sync”. Provider credentials, quota responses, sanitized
quota history, poster avatars, and local preferences never participate in sync.

See [network behavior](../NETWORK.md), [privacy](../PRIVACY.md), and the
[product boundary](./PRODUCT_BOUNDARY.en.md) for destinations and uploaded fields.

## Ask an agent to connect

If you have decided to connect and sync the community, use this prompt instead.
The agent must pause for your device approval and must not install continuous
background sync on its own:

```text
Read these documents and follow their current instructions:
- https://github.com/kimi-builders/usage/blob/main/docs/COMMUNITY_SYNC.en.md
- https://github.com/kimi-builders/usage/blob/main/PRIVACY.md
- https://github.com/kimi-builders/usage/blob/main/NETWORK.md

Help me connect Kimi Builders Usage to kimi.builders and perform one sync.
Check Node.js 20+ and run the offline dry-run first. Then check the existing
connection with `npx @kimi.builders/usage@latest status`. If this device is not
connected, run `npx @kimi.builders/usage@latest init`, open the device approval
page, and pause so I can review and approve it. After approval, complete one
`npx @kimi.builders/usage@latest sync`, verify the final status, and launch the
local dashboard. Never print or copy API keys, cookies, credentials, full local
paths, session identifiers, or conversation content. Do not install, restart,
or remove the background daemon unless I explicitly approve that separate step.
```

## Sync commands

| Command | Purpose | Network |
| --- | --- | --- |
| `sources set <agent> off\|local\|private` | Set one agent's scan and sync scope | No |
| `init [--api-url URL] [--sync] [--skip-pricing-update]` | Connect a community device and best-effort refresh public pricing; `--sync` alone uploads usage immediately | Yes |
| `sync [--full]` | Upload changed aggregates; `--full` explicitly replays allowed sources | Yes |
| `daemon install/status/restart/uninstall` | Manage background sync scheduler | See NETWORK |
| `summary [--days N] [--remote]` | Read usage summary (local-first by default, `--remote` for cloud) | No local / Yes remote |
| `reset --local` | Clear local sync checkpoints | No |
