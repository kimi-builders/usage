# Kimi Builders Usage 0.4.1

> [中文](./RELEASE_NOTES_0.4.1.md)

`0.4.1` was the first public-Beta patch. It fixed a first-sync failure under the
default privacy setting and made installation and startup easier to understand.

## Fixes

- Fixed bucket merging with project upload disabled. When the first local project
  in one Claude Code wire bucket omitted five-minute cache-write data and a later
  project supplied it, the Collector now treats the absent value as `0` instead
  of reporting that `undefined + Token` exceeded JavaScript's safe integer range.
- Added a real-order regression test covering optional cache-TTL partitions before
  and after privacy merging.
- The fix did not change the upload protocol, Token categories, project privacy
  default, or server schema.

## Getting started

- Reorganized the README opening into positioning → one command → first-run steps
  → offline diagnostics, so users no longer search past screenshots and long lists.
- Added clear local usage, subscription limit, and community sync paths with short
  answers about accounts, privacy, cost definitions, and supported platforms.
- Added copyable prompts for local Agents such as Codex, Claude Code, and Kimi Code.
  The local template only starts the dashboard; the community template must pause
  for device approval.
- Agent prompts prohibit credential, full-path, session-ID, and capability-token
  disclosure and never enable quotas or install background sync without permission.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

If `0.4.0` authorized the device but the first sync failed, do not authorize again:

```bash
npx @kimi.builders/usage@latest sync
```

Users with background sync installed should refresh its path:

```bash
npx @kimi.builders/usage@latest daemon restart
```

These commands do not delete local history, the community connection, or remote
data. See [`PRIVACY.md`](../PRIVACY.md) and [`NETWORK.md`](../NETWORK.md).
