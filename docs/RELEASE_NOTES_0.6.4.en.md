# Kimi Builders Usage 0.6.4

> [中文](./RELEASE_NOTES_0.6.4.md)

## Usage history and sync

- Kimi Work desktop sessions are now visible locally. Copies shared by the CLI and desktop are counted once. Existing CLI sync permissions do not include the desktop store. To opt in, run `kbu-usage sources set kimi-code private --include-desktop`; run it again without the flag to return to CLI-only sync.
- Codex reads compressed `.jsonl.zst` history and merges resumed segments of a session. Usage and timing samples retain their segment's project and version. Back-to-back sub-agent tasks no longer lose the first task's usage. Unreadable archives mark the scan as partial without hiding readable sessions.
- Claude Code counts multiple content blocks and streaming revisions of a call once, even when a later revision adds a request ID. Retries with distinct request IDs still count separately.

## Models and cost estimates

- The November price catalog (revision 13) matches the model ID after the last slash. Renaming a gateway or profile does not change the estimate for the same model.
- Codex and OpenCode determine GPT‑6.2 context pricing from each request's full prompt, including cached input, rather than the half-hour total.
- GPT‑6.2 Ultrafast has separate rates and a dated transition from promotional to list pricing. Community protocol v2 cannot represent Ultrafast buckets yet: they remain available locally and are reported as skipped during sync, never sent as Standard. API-equivalent costs are estimates, not subscription charges.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

If background sync is installed, run `npx @kimi.builders/usage@latest daemon restart` to update the scheduled runtime. There is no need to clear local history, reconnect your device, or request a full sync.
