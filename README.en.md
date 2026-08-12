# Kimi Builders Usage

[简体中文](./README.md) · [English](./README.en.md)

An open-source, local-first usage center for AI coding agents. One scan gives
you a private browser dashboard for tokens, standard-API cost estimates, active
time, models, and projects across multiple agents. The complete local dashboard
works without an account or a network connection.

If you choose to connect the community, the same Collector can send redacted
aggregates to [kimi.builders/usage](https://kimi.builders/usage) for multi-device
analysis, public profiles, and leaderboards. Local analytics and community sync
are separate capabilities: **opening the dashboard never uploads data.**

## What you get

- A complete local dashboard for Today, 24H, 7D, 30D, 90D, and all history.
- One cross-agent contract for input, cache writes, cache reads, output,
  reasoning, requests, and sessions.
- Trends, natural-week comparisons, hourly activity, distributions, records,
  CSV/JSON exports, and share posters.
- Canonical model identity, reasoning effort, agent version, terminal, and OS
  facts when the source provides them.
- Standard API price estimates with pricing coverage and unpriced-token
  disclosure. These estimates are not subscription bills.
- An optional Subscription Center for quota history, burn pace, token capacity,
  and value observations, plus optional manual or background community sync.

**Project status:** `0.4.0` is currently a source-available beta. npm publication
is intentionally deferred by the maintainer. Core product capabilities are in
place; the next milestone focuses on cross-platform CI, a parser compatibility
matrix, large-history performance, and provider-drift management.
[Roadmap](./docs/ROADMAP.md) · [Contributing](./CONTRIBUTING.md) ·
[Support](./SUPPORT.md) · [All docs](./docs/README.md)

## Real product screenshots

These screenshots and posters are generated from real local Agent logs by this
project. They are not mockups or seeded demo data.

### Local dashboard

![Local dashboard overview and subscription limits](./docs/assets/screenshots/dashboard-overview.png)

![Daily trend, natural-week trend, and hourly activity](./docs/assets/screenshots/dashboard-trends.png)

### Share usage

Posters contain only usage insights suitable for sharing. They exclude projects,
devices, paths, conversation content, and unreachable localhost QR codes. You can
choose a custom avatar; it is center-cropped and stored only in the current browser,
never uploaded to the community or a third party.

<p align="center">
  <img src="./docs/assets/screenshots/usage-poster-24h.png" alt="Last 24 hours usage poster" width="48%">
  <img src="./docs/assets/screenshots/usage-poster-30d.png" alt="Last 30 days usage poster" width="48%">
</p>

## Getting started

### Run from source (available now)

[Node.js 20+](https://nodejs.org/) is required.

```bash
git clone https://github.com/kimi-builders/usage.git
cd usage
npm run setup
npm run dev
```

`npm run setup` installs dashboard development dependencies once. `npm run dev`
starts the local API and Vite dashboard, then opens the authorized browser URL.
You do not need two terminals.

To keep the browser closed:

```bash
npm run dev -- --no-open
```

### After the npm package is published

The npm package has not been published yet. Once released, the normal entry
point will be:

```bash
npx @kimi-builders/usage dashboard
```

It scans local data, starts a private server bound only to `127.0.0.1`, and
opens a one-time authorized URL. Press `Ctrl+C` or close the terminal to stop it.

The examples below use the future `npx @kimi-builders/usage …` form. In a source
checkout, replace it with `node ./bin/kbu-usage.js …`.

## Three capabilities, three explicit boundaries

| Capability | Network by default | Account required | Data destination |
| --- | --- | --- | --- |
| Local token dashboard | No | No | Local memory and browser only |
| Subscription limits | No; opt in per provider | Existing provider login or manual credential | Directly from this machine to the selected provider |
| Community sync | No; explicit connection required | kimi.builders | Redacted aggregates |

The cloud cannot pull files from your computer. The Collector sends community
data only when you run `sync`, press “Sync data”, or explicitly install the
background service. See [NETWORK.md](./NETWORK.md) for every network target.

## Local dashboard

```bash
npx @kimi-builders/usage dashboard
```

Every launch creates a new browser capability token. The server rejects
non-loopback peers, unexpected Host/Origin values, and unauthorized requests.
“Rescan” refreshes local data only; “Sync data” is a separate explicit action.

The local price catalog matches models by effective date, context tier, and
processing tier against standard API prices. Pricing coverage, assumed prices,
and unpriced tokens remain visible so an incomplete estimate cannot look like a
real invoice.

Session timing uses the same bounded-work definition across tools:

- active time counts assistant/tool gaps up to five minutes each;
- engaged time counts user-to-assistant/tool turn gaps up to 30 minutes each;
- a long-lived session ID cannot turn offline days into continuous work.

See [Local Snapshot v1](./docs/LOCAL_SNAPSHOT_V1.md) for fields and formulas.

## Supported local usage sources

| Agent | Status | Local source |
| --- | --- | --- |
| Kimi Code | Core | `~/.kimi-code` and legacy `~/.kimi` |
| Claude Code | Stable | `$CLAUDE_CONFIG_DIR` and project logs under `~/.claude*` |
| Codex | Stable | Current and archived sessions under `$CODEX_HOME` or `~/.codex` |
| OpenCode | Stable | SQLite database with legacy JSON fallback |
| Gemini CLI | Stable | JSONL/JSON sessions under `~/.gemini/tmp` |
| Antigravity | Stable | Offline SQLite stores from App 2.0 / `agy` CLI |
| GitHub Copilot CLI | Stable | Local CLI session logs |
| Roo Code | Stable | Local VS Code extension task data |
| Cursor | Explicit opt-in | Usage CSV exported by Cursor Dashboard |

Sources are parsed independently. A missing, damaged, or changed source never
blocks another source and never clears that source's previous sync checkpoint.
These diagnostics stay offline:

```bash
npx @kimi-builders/usage inspect --dry-run
npx @kimi-builders/usage doctor
npx @kimi-builders/usage sources list
```

`doctor --json` is designed for issue reports. It excludes paths, projects,
models, session IDs, and row timestamps, but still contains aggregate counts and
redacted parser errors. Review it before sharing.

Cursor is currently the only usage source that requires explicit configuration:

```bash
npx @kimi-builders/usage sources enable cursor --csv /path/to/usage.csv
npx @kimi-builders/usage sources disable cursor
```

Cursor source settings currently share the community-device config file, so one
`init` is required before those commands. Normal local scans still remain
offline afterward.

## Subscription limits (optional)

Subscription limits are not local token consumption. They are off by default.
The Collector contacts a provider only after you enable it, using an existing
local login or a credential source you choose.

Current integrations cover Codex, Claude Code, Kimi Code, Cursor, GitHub
Copilot, Gemini CLI, Antigravity, OpenCode, Qoder, Warp, JetBrains AI, and
Windsurf. Depending on the provider, setup can use local detection, an
environment variable, or macOS Keychain. Trae has no stable independently
verifiable personal-limit interface, so it is labeled unavailable rather than
showing invented data.

Kimi Code appears first by default. Grab the handle to drag any enabled provider
into place with a mouse or touch; the order is stored locally and reused for both
quota tabs and provider requests.

Every successful refresh stores one sanitized quota snapshot locally. The
Subscription Center aligns changes in the same provider window with local Token
usage to show burn pace, projected utilization at reset, 30-day actual cost per
million Tokens, standard-API-equivalent value, and model concentration. Every
observation identifies its evidence window. It never changes a plan automatically
or presents observed utilization as a provider-published fixed Token cap.

Quota credentials and responses never enter token snapshots, exports, or
community sync. Manual secrets are not stored in the normal `config.json`.
Sanitized history is retained for at most 400 days and downsampled as it ages; it
also stays out of exports, posters, and community sync. Provider endpoints and
authentication boundaries are in [NETWORK.md](./NETWORK.md), and locally stored
fields are documented in [PRIVACY.md](./PRIVACY.md).

## Connect and sync the community (optional)

Connect the device once:

```bash
npx @kimi-builders/usage init
```

The terminal shows a device code and opens the community approval page. After
approval, the device receives an independently revocable `kbu_` key. Project
upload is off by default; when disabled, the JSON payload has no `project` field.

Run one sync:

```bash
npx @kimi-builders/usage sync
```

Or install continuous per-user sync:

```bash
npx @kimi-builders/usage daemon install --interval 15
npx @kimi-builders/usage daemon status
npx @kimi-builders/usage daemon restart
npx @kimi-builders/usage daemon uninstall
```

The service needs no administrator privileges. It uses `launchd` on macOS,
user `systemd` on Linux, and Task Scheduler on Windows. It works only while the
device is awake and online. After upgrading the Collector, run `daemon restart`
so the service records the new package path.

Sync uses incremental checkpoints, per-source failure isolation, and a
concurrency lock. Repeated runs do not duplicate counts. If you delete a device's
remote history and want to upload the local history again:

```bash
npx @kimi-builders/usage reset --local
npx @kimi-builders/usage sync
```

## Command reference

| Command | Purpose | Network |
| --- | --- | --- |
| `dashboard [--no-open] [--port N]` | Start the local dashboard | No by default |
| `inspect --dry-run` | Show roots and parser results | No |
| `doctor [--json]` | Produce a redacted compatibility report | No |
| `sources list` | Show local usage-source status | No |
| `init [--api-url URL]` | Connect a community device and perform the first sync | Yes |
| `sync` | Upload changed aggregate records | Yes |
| `daemon install/status/restart/uninstall` | Manage background sync | See NETWORK |
| `summary [--days N]` | Read the connected account's hosted summary | Yes |
| `status` | Show local connection and checkpoint state | No |
| `reset --local` | Clear local sync checkpoints | No |

Local configuration and checkpoint state live under
`~/.kimi-builders/usage/`. Sensitive config files use mode `0600` on POSIX.

## Privacy promise

The Collector **never uploads**:

- prompts, responses, reasoning text, or tool results;
- full paths, file contents, repository remotes, or environment dumps;
- raw session IDs;
- provider cookies, OAuth tokens, API keys, or quota responses;
- local dashboard filters, navigation, or interaction events.

Session IDs are transformed with HMAC-SHA-256 and a random installation-local
salt, so different devices cannot correlate the result. The local snapshot may
keep a project-directory basename for private analysis; community sync removes
the project field by default.

Further reading:

- [Development roadmap](./docs/ROADMAP.md)
- [Contributing](./CONTRIBUTING.md)
- [Support and troubleshooting](./SUPPORT.md)
- [Privacy boundaries](./PRIVACY.md)
- [Per-command network inventory](./NETWORK.md)
- [Threat model](./THREAT_MODEL.md)
- [Security reporting and release requirements](./SECURITY.md)
- [Local/community product boundary](./docs/PRODUCT_BOUNDARY.md)

## Development and verification

```bash
npm run setup
npm run dev
```

Before a commit:

```bash
npm test
npm run dashboard:build
npm run dashboard:test
```

Before a release:

```bash
npm run release:check
```

This runs Collector tests, builds and tests the dashboard, and uses
`npm pack --dry-run` to show the exact package contents. `npm publish` runs the
same gate through `prepublishOnly`, but the check command never publishes by
itself. See [PUBLISHING.md](./PUBLISHING.md).

Tests redirect every source, config, and state path to temporary fixtures. They
do not read the developer's real HOME.

Before submitting parser, quota-provider, sync-protocol, or UI changes, follow
the relevant privacy and test checklist in [CONTRIBUTING.md](./CONTRIBUTING.md).
Do not open a public Issue for a vulnerability; use the private reporting path
documented in [SUPPORT.md](./SUPPORT.md).

## License and acknowledgements

The complete project is released under the [MIT License](./LICENSE). Original
project contributions are © 2026 `kimi.builders contributors`.

Parts of the initial parser layer and related tests were adapted from the
MIT-licensed [`@vibe-cafe/vibe-usage`](https://github.com/vibe-cafe/vibe-usage).
The Vibe Usage desktop clients were direct product references, and parts of the
provider-specific quota protocols and parsers were adapted from CodexBar. Code
adaptations, product references, and bundled dependencies are recorded
separately and do not imply joint ownership, maintenance, or endorsement. See
[NOTICE](./NOTICE) for the complete provenance record.
