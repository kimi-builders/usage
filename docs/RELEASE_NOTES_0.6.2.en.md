# Kimi Builders Usage 0.6.2

> [中文](./RELEASE_NOTES_0.6.2.md)

## Local scanning and model pricing

- Update Codex durable request usage and deduplication, with local-only performance
  evidence from complete successful turns. Turn duration includes tools and waiting,
  not pure model generation speed. Raw IDs and performance samples never enter sync.
- Extend Cursor, OpenCode, MCode, Grok, DSH, and ZCode log-format and damaged-record
  handling. OpenCode supports independent source locations; a failed source does
  not discard readable facts from other sources.
- Refresh the October pricing catalog and model identities. Pricing details expose
  context tiers, cache-write TTL, provisional rates, and unpriced data. API-equivalent
  value remains an estimate, not a subscription bill or realized savings.
- Add a scan benchmark command reporting time and memory without uploading logs.

## Accounts and official benefits

- Kimi Code supports one local CLI login plus independent Coding API-key accounts
  and newer quota responses. Each connection owns its credentials, declared plan,
  and history. Only returned windows appear; weekly quota is never invented.
  Verified shared owners use installation-salted identities for deduplication;
  local Tokens remain unlinked when ownership cannot be proven.
- Add an explicit OpenCode Go local-login mode. Manual accounts with missing
  credentials never borrow another login.
- Add WorkBuddy website Credits queries using an explicitly supplied Cookie and
  User-Agent tuple, without importing browser sessions. Credits, reservations,
  and cycle-end dates are not converted to Tokens.
- Extend Claude reset vouchers, promotional cloud Credits, verifiable renewal/expiry
  facts, and JetBrains local-log quota reading. Optional metadata failure does not
  hide valid existing quota.
- Improve account editing and save feedback: preserve unsaved edits, clear submitted
  secret drafts, and prevent stale settings from overwriting newly connected accounts.

## Dashboard and release quality

- Align Inter typography, blue accents, dot-field textures, and staged chart motion,
  preserving system-font fallbacks and reduced-motion preferences.
- Ship only Latin / Latin-ext WOFF2 for three Inter weights, avoiding duplicate
  formats and unrelated script subsets. Restore milestone celebration tint and add
  regression checks for font artifacts and valid backgrounds.
- Keep local observations, provider facts, derived estimates, and user-declared
  targets distinct. This release does not expand sync fields or default permissions.
- Update the older OpenCode root test: Windows native storage supplements XDG,
  while explicit directory overrides remain exclusive.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

Existing background-sync users can choose “Update to this version” in the Dashboard
or run:

```bash
npx @kimi.builders/usage@latest daemon restart
```

Upgrading preserves local history, configuration, and community connections. New
quota providers require explicit configuration; local scans do not depend on those
credentials or online queries.
