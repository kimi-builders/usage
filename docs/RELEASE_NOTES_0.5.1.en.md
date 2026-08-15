# Kimi Builders Usage 0.5.1

> [中文](./RELEASE_NOTES_0.5.1.md)

`0.5.1` updates local-dashboard presentation, pricing, subscription-limit
compatibility, and complete bilingual documentation for the public project.

## Usage presentation and posters

- Chinese now uses localized compact numbers such as `26.2亿`, `160万`, and
  `48.1万`; English continues to use K/M/B. Usage views, charts, records,
  Subscription Center, and posters share one convention.
- “Share results” is now “Share usage”. English posters again use independent
  English copy instead of Chinese labels.
- Added locale tests for Tokens, request counts, and user messages to prevent drift.

## Model pricing

- Updated the local standard API price catalog for Grok 4.5, GPT 5.6 Luna, GLM,
  Kimi, MiMo, MiniMax, Qwen, DeepSeek, Hy3, and their applicable context tiers.
- Pricing still matches effective time, context tier, and processing tier.
  Unmatched Tokens remain visible as unpriced and never become $0 usage.

## Subscription-limit compatibility

- GitHub Copilot now uses an explicit device-authorization flow and supports
  separately stored accounts and quota histories.
- OpenCode Go stores one Cookie per real account, discovers its Workspace, and
  accepts an optional per-account `wrk_…` override. Setup no longer squeezes
  several accounts into one field group.
- Improved quota-history account ownership, query concurrency, and provider-level isolation.
- Removed the no-longer-verifiable Windsurf/Devin quota integration instead of
  presenting guessed or perpetually failing data.

## Documentation and language

- Agent handoff prompts now follow README language: Chinese instructions in the
  Chinese README and English instructions in the English README.
- Every public user and maintainer document except LICENSE and NOTICE now has
  linked Chinese and English editions.
- Updated the documentation index, roadmap, compatibility matrix, network, and
  privacy descriptions to match `0.5.1` behavior.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

Users with background sync installed should refresh its recorded package path:

```bash
npx @kimi.builders/usage@latest daemon restart
```

The upgrade does not change selected scan/sync scopes or delete local history,
community connection, provider accounts, or remote data.
