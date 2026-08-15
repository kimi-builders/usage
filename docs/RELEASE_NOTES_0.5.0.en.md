# Kimi Builders Usage 0.5.0

> [中文](./RELEASE_NOTES_0.5.0.md)

`0.5.0` combined local scanning, community connection, and sync scope into one
user-controlled workflow. It remained local by default: connecting a device was
not upload, and only Agents explicitly marked Local + sync entered later syncs.

## Data scope and privacy controls

- Added per-Agent Off / Local only / Local + sync modes. Off sources are not parsed;
  Local only sources participate only in device analysis; new sources never silently sync.
- Existing connected installations retain their previous coverage until the user
  explicitly saves the new policy.
- Project names, session identity, conversation content, full paths, and provider
  credentials continue to obey existing privacy boundaries.
- The local dashboard centralizes scan scope, community connection, background
  sync, device revocation, and current-device cloud deletion.

## Device authorization and sync reliability

- The dashboard retains a pending device code across refresh, with explicit expiry,
  rejection, and retry states. Codes exist only in the local process and never in
  browser storage or config files.
- Disconnect first attempts to revoke the remote key. If the community is unreachable,
  local connection is retained with an explicit, risk-labelled local-clear fallback.
- Checkpoints bind to the community target and device. When the incremental baseline
  cannot be proven, ordinary sync stops and asks for an explicit full replay.
- “Sync now” shows elapsed time, honest indeterminate progress, and success,
  unchanged, partial, quarantined-record, or failure results. Failed sources retain
  their previous community data.

## Dashboard experience

- Community states cover approval wait, expired code, rejection, invalid connection,
  and connected; connected is no longer presented as synced.
- The long sync dialog has a fixed header and independent scrolling content, so
  the scrollbar does not cross rounded corners and content does not overlap.
- Both READMEs document device-code lifetime and connection-versus-sync boundaries.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

Users with background sync installed should refresh its path:

```bash
npx @kimi.builders/usage@latest daemon restart
```

The upgrade does not delete local history, community connection, or existing remote
data. Review every Agent's data mode before the first sync in the new dashboard.
