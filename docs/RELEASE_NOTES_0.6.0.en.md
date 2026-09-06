# Kimi Builders Usage 0.6.0

> [中文](./RELEASE_NOTES_0.6.0.md)

`0.6.0` expands local data-location and Agent coverage, adds Kiro benefits,
and strengthens release safeguards for malformed records, scan performance,
and source-health reporting. Upgrading never expands community-sync scope.

## Sources and additional directories

- Added local usage parsers for Grok CLI, Trae CLI, and MiniMax Code, explicitly
  retaining their Beta maturity labels.
- Codex, Antigravity, Pi, Grok, and Trae accept additional local data directories.
  Full paths stay on-device; the browser receives only directory names and opaque IDs.
- Codex parent-directory discovery now has directory and entry safety budgets, failing
  quickly with a narrower-directory prompt when a broad location is selected.
- Pi and Trae discard records without trustworthy timestamps instead of creating
  Token or session activity in 1970.

## Benefits and trust

- Added Kiro monthly and overage Credits from the local Kiro CLI login while keeping
  Credits visibly separate from Tokens.
- Kiro now fails closed on negative, non-numeric, or impossible overage relationships
  instead of presenting malformed provider responses as zero usage.
- Agents that are not installed or have no local data now appear as neutral “not
  detected” entries and no longer trigger parser-health warnings.

## Release engineering

- The CLI, background sync, diagnostics, sources, and shell completions now share
  the language saved by the Dashboard. An explicit `--lang` still takes precedence,
  and English mode no longer leaks Chinese startup or status messages.
- Updated the standard API price catalog to `2026-09-06`, using first-party OpenAI,
  Anthropic, Google, xAI, and DeepSeek documentation as pricing authority.
  OpenCode-only offers now match only OpenCode observations instead of leaking across
  Agents. AI Pricing Guru is a maintainer-CI drift signal only; it cannot change prices
  or run in the installed product. Rates remain standard API-equivalent estimates,
  not subscription, channel, or BYOK invoices.
- Updated the Dashboard build chain to patched Vite and transitive dependency versions.
- Added production-dependency auditing to CI and release checks while retaining the
  cross-platform matrix, package audit, SBOMs, and provenance.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

Users with background sync installed can refresh its package path with:

```bash
npx @kimi.builders/usage@latest daemon restart
```

The upgrade does not delete local history, community connections, provider accounts,
credentials, or remote data.
