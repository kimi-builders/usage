# Kimi Builders Usage 0.4.0

> [中文](./RELEASE_NOTES_0.4.0.md)

`0.4.0` was the first public Beta: an open-source, local-first multi-Agent usage
and subscription analytics tool.

## Main capabilities

- Analyze eleven automatic sources and one explicit Cursor CSV source in a
  loopback-only web dashboard.
- Show Token usage, standard API equivalent cost, active time, trends, natural
  weeks, heatmaps, distributions, records, budgets, spikes, and milestones for
  Today, 24H, 7D, 30D, 90D, and all history.
- Keep input, cache write, cache read, output, and reasoning Tokens mutually
  exclusive while preserving evidenced model, reasoning effort, Agent version,
  context-tier, and processing-tier facts.
- Export local CSV/JSON and create share posters without localhost QR codes.
- Provide a separate Subscription Center for twelve provider categories, keeping
  redacted quota history and separating provider facts, local Tokens, and
  assumption-bound capacity/value estimates.
- Optionally connect kimi.builders for one-shot sync and background sync through
  macOS `launchd`, Linux user `systemd`, or Windows Task Scheduler.

## Privacy and security

- The local dashboard needs no account and stays offline by default; opening it
  never uploads automatically.
- It does not read or upload prompts, responses, reasoning text, tool results,
  full paths, or file contents.
- Session IDs use HMAC with an installation-local random salt; project upload is off.
- Provider credentials and raw quota responses never enter browser responses,
  exports, posters, or community sync.
- The local HTTP service listens only on loopback, uses a random per-launch
  capability token, and validates Host, Origin, and write-request type.
- The Collector package has no runtime dependency or install/postinstall script.

## Release quality

- GitHub Actions covers Ubuntu Node 20/22/24 and macOS/Windows Node 22/24.
- Provider contract tests use redacted success/error fixtures and never contact real accounts in CI.
- GitHub Release triggers publication. The first release used a one-time credential,
  then migrated to npm Trusted Publishing. The workflow generates provenance,
  an SBOM, and an audited tarball.
- Release gates cover Collector tests, dashboard build/tests, Markdown links,
  and `npm pack` auditing.

## Known boundaries

- Pi Coding Agent, ZCode, and WorkBuddy/CodeBuddy are Beta sources; see the
  [compatibility matrix](./SOURCE_COMPATIBILITY.en.md).
- Cursor requires an explicitly enabled CSV exported from Cursor Dashboard.
- Standard API cost is a coverage-aware equivalent estimate, not a subscription
  bill; CNY is a sourced display conversion.
- Provider quota interfaces may be undocumented or semi-public and are best effort;
  failures never block the Token dashboard.
- First scans and very large histories still have performance headroom; this
  release installs no global index and modifies no Agent logs.
- Community rankings reflect submitted local aggregates, not provider-certified
  bills or proof of work.

## Upgrade and background service

```bash
npx @kimi.builders/usage@latest dashboard
```

Users with background sync installed should refresh its recorded executable path:

```bash
npx @kimi.builders/usage@latest daemon restart
```

This does not delete local history, community connection, or remote data. See the
README, [`PRIVACY.md`](../PRIVACY.md), and [`NETWORK.md`](../NETWORK.md) for the
complete commands and boundaries.
