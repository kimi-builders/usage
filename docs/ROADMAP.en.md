# Development roadmap

> [中文](./ROADMAP.md)
>
> Current version: `0.5.3` (public Beta feature release)
>
> This roadmap states priorities and acceptance criteria, not release dates.
> Provider facts, local observations, user-declared goals, and assumption-bound
> estimates must remain separate.

## Current conclusion

The product and engineering foundation meets the bar for a public Beta: multi-Agent
local scanning, complete Usage and Subscription Centers, optional community sync,
three-platform background services and CI, provider contract tests, npm provenance,
and package auditing are implemented. Documentation screenshots, clean-checkout
verification, real tarball install smoke tests, first-release credentials, and
GitHub Release configuration were completed; releases now use npm Trusted Publishing.

## Completed

### Collector and Usage Center

- [x] Eleven automatic local sources plus explicit Cursor CSV, with isolated failures.
- [x] 30-minute buckets and mutually exclusive input, cache-write, cache-read,
  output, and reasoning Tokens.
- [x] Raw/canonical model, provider, reasoning effort, Agent version, context tier,
  and processing tier.
- [x] Installation HMAC session ID, hourly activity slices, five-minute active and
  thirty-minute engaged caps.
- [x] Today / 24H / 7D / 30D / 90D / All, compound filters, sticky filters, and
  shareable hash navigation.
- [x] Overview, trends, natural weeks, activity, distribution, records, budget,
  hourly spike detection, streaks, and milestones.
- [x] Standard API equivalent cost, versioned pricing, coverage, unpriced warnings,
  and source-backed CNY display conversion.
- [x] CSV/JSON export, local avatar, and share posters without localhost QR codes.
- [x] Desktop/mobile, dark/light, Chinese/English, and baseline keyboard/touch accessibility.

### Subscription Center

- [x] Usage and Subscription Centers are peers; subscription analysis ignores
  temporary Usage filters.
- [x] Codex, Claude Code, Kimi Code, Cursor, GitHub Copilot, Antigravity,
  OpenCode Go, Qoder, Warp, and JetBrains AI; Trae is explicitly unavailable
  without a reliable interface.
- [x] Official quota windows, same-period local Tokens, burn pace, capacity range,
  renewal forecast, value, and concentration analysis.
- [x] User-entered price/currency/billing cycle; free and promotional benefits do
  not inflate paid-subscription spending.
- [x] Redacted quota history, evidence drilldown, 30/90-day/all ranges, and drag-to-order providers.
- [x] Provider endpoint allowlist, credential isolation, success/error fixtures,
  and runtime contract tests.

### Community, background service, and release engineering

- [x] Device-code authorization, revocable device keys, project names off by default,
  post-privacy wire-key merging, and incremental checkpoints.
- [x] macOS `launchd`, Linux user `systemd`, and Windows Task Scheduler.
- [x] Ubuntu Node 20/22/24, macOS Node 22/24, and Windows Node 22/24 release matrix.
- [x] Markdown links, network declarations, fixture safety, package content/size,
  zero runtime dependency, and no-install-script auditing.
- [x] GitHub Release → npm Trusted Publishing, OIDC provenance, CycloneDX SBOM,
  and tarball artifacts.
- [x] Custom community origins require HTTPS; HTTP is allowed only for localhost/loopback.

## 0.4.0 release checklist

- [x] Correctness, private sync, Cursor quotas, huge-history stack safety, and Windows auth fixes.
- [x] Pi, ZCode, and WorkBuddy/CodeBuddy marked Beta with evidence and a compatibility matrix.
- [x] `package.json` set to `0.4.0` and release notes created.
- [x] README screenshots replaced with the final UI and checked for private data.
- [x] README, LICENSE, NOTICE, docs, and screenshots included in the release commit.
- [x] `npm run release:check` passed from a clean checkout.
- [x] The real `.tgz` was inspected, installed in an empty directory, and smoke-tested.
- [x] One-time bootstrap credentials, remote/default branch, and workflow permissions verified.
- [x] GitHub Release `v0.4.0` created; publication occurred through CI, not a workstation.

## Post-release P0: compatibility feedback and quick fixes

Goal: safely collect, reproduce, and fix public-Beta issues.

- Maintain the [source compatibility matrix](./SOURCE_COMPATIBILITY.en.md) with
  Agent versions, platforms, fixtures, and verification dates.
- Add historical, truncated, duplicate/copied, Windows, and Node 20 positive
  fixtures for Pi, ZCode, and WorkBuddy.
- Track provider-contract drift and distinguish authentication failure, API drift,
  absent quota, and network failure.
- Publish parser/provider regressions as patch versions; do not change upload
  protocol or privacy defaults in a patch.
- Record startup, scan-time, and package-install issues without telemetry or
  automatically uploaded diagnostics.

Acceptance: a public report can be reproduced with a redacted fixture; one Agent
upgrade does not break other sources or dashboard startup.

## Post-release P1: huge history and incremental performance

Goal: predictable behavior across years, tens of thousands of files, and hundreds
of thousands of buckets.

- Benchmark cold/warm scans, dashboard conversion, export, and posters at 100k/500k buckets.
- Record file count, bytes read, per-source time, peak memory, and payload size.
- Design parser checkpoints/indexes while correctly handling append, truncation,
  rotation, SQLite watermarks, and Codex fork/replay.
- Stream or explicitly bound large exports; paginate or virtualize long record lists.
- Split the main frontend chunk by page/dialog while retaining fast local first load.

Acceptance: establish a repeatable baseline before optimization; never sacrifice
deduplication, corruption recovery, or recalculation correctness.

## Post-release P1: subscription decision quality

- After several complete cycles, show typical Token-capacity ranges and unit-cost trends.
- Add a pre-renewal review with cycle facts, remaining quota, standard API equivalent,
  and next-cycle recommendation.
- Detect overlapping subscriptions while letting users declare irreplaceable uses;
  free/promotional accounts must not generate false cancellation advice.
- Agent analysis produces evidence-backed read-only suggestions and never changes
  plans, credentials, provider settings, or local workflows.
- Every suggestion identifies provider observation time, local Token window,
  user-declared price, and assumptions.

## Post-release P2: local experience and community value

### Local experience

- [x] Per-Agent Off / Local only / Local + sync settings, browser first-run wizard,
  and lossless migration of existing settings.
- [x] Community device authorization, one-shot sync, daemon install/status/disable,
  disconnect, and current-device cloud deletion in a safe UI.
- Custom date ranges and saved filter views.
- Safely inspect background-sync log text in the dashboard; currently only the
  redacted path and recent status are shown.
- Private snapshot backup/restore and a portable format.
- Full accessibility audit for screen readers, contrast, keyboard, touch, and reduced motion.

### Community-only value

- Continuous multi-device history, device revocation, and replay status.
- Token Usage and work-build rankings with unverified-local-data disclosure and anti-abuse boundaries.
- Anonymous Agent/model/reasoning benchmarks and percentiles.
- Revocable public profiles, achievements, work associations, and share entries.
- Shared frozen Collector/site fixtures to prevent Token, cost, and time drift.

## Explicitly not planned or promised

- Never upload prompts, responses, reasoning text, tool results, file contents,
  or provider credentials.
- Never describe local-log rankings as provider-certified bills, productivity,
  or settlement-grade proof of work.
- Never invent remaining quota, “unlimited”, or precise Token ceilings when unobservable.
- Never let the community remotely enable scan paths, quota providers, daemons,
  or upload fields.
- Never add provider quantity at the expense of evidence, privacy review, or failure isolation.
- No desktop distribution promise until signing, update security, and independent
  uninstall are designed.

Contribution requirements are in [`CONTRIBUTING.en.md`](../CONTRIBUTING.en.md),
support and private reporting in [`SUPPORT.en.md`](../SUPPORT.en.md), and product
boundaries in [`PRODUCT_BOUNDARY.en.md`](./PRODUCT_BOUNDARY.en.md).
