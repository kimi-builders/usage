# Kimi Builders Usage 0.6.3

> [中文](./RELEASE_NOTES_0.6.3.md)

## StepCode and Step Plan

- Add Beta StepCode session scanning with separate input, output, cache, and
  reasoning Tokens. Deduplicate copied records and isolate forked records whose
  ownership cannot be verified. The new source defaults to local analysis, not sync.
- Support the official `STEP_CODING_AGENT_SESSION_DIR`, Agent directory, and config
  namespace, preserving scan locations in background-service descriptors.
  Unreadable explicit locations never fall back to another installation.
- Add read-only personal Step Plan quota lookup through the current StepCode login.
  Cleared, damaged, or expired current credentials never borrow an older account.
  Credits are not converted to Tokens.

## Data and account compatibility

- Update Antigravity usage metadata, retry deduplication, and output/reasoning
  classification. Missing clocks or unprovable overlap remain incomplete evidence.
- Extend Cursor CSV and official quota windows, WorkBuddy paid-cycle precedence,
  JetBrains quota-log formats, and Antigravity quota-group compatibility. Cursor
  usage remains an explicitly configured offline CSV import.
- Tighten OpenCode Go local-login boundaries: an existing current credential store
  is authoritative. Missing, expired, ambiguous, or unreadable current credentials
  never borrow an older account.
- Refresh late-October versioned model prices and identities, preserving effective
  dates, context conditions, promotional periods, and unpriced data. API-equivalent
  value is an estimate, not a subscription bill or realized savings.

## Sync feedback and release quality

- Explain usage buckets protected by existing community data, without marking the
  entire affected batch as delivered. Full sync does not override protection,
  reset checkpoints, or automatically replay history.
- Upgrade Vite to 6.4.5 and compress the dot-field texture using an equivalent SVG
  pattern, preserving its appearance and the strict package-size gates.
- Add credential, directory, background-service, and build-artifact regression
  coverage, with updated Chinese and English network and source-compatibility docs.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

Existing background-sync users can choose “Update to this version” in the Dashboard
or run:

```bash
npx @kimi.builders/usage@latest daemon restart
```

Upgrading preserves local history, configuration, and community connections.
Step Plan lookup requires explicit configuration. Local scanning does not depend
on online quota queries or automatically expand existing community-sync permissions.
