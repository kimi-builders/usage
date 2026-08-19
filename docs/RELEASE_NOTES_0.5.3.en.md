# Kimi Builders Usage 0.5.3

> [中文](./RELEASE_NOTES_0.5.3.md)

`0.5.3` restructures the Benefit Center, expands provider coverage, and fixes
Kimi Code quota lookup after the local access token expires. Quota retrieval
and Token analysis remain on-device, and the community-sync scope is unchanged.

## Benefit overview and Accounts

- The Benefit overview keeps its connected, personally paid, non-paid, local
  Token, and official-fact summaries, then adds resetting-soon, 5-hour,
  weekly, and account-reset views.
- A dedicated Accounts page now holds each account's official quota or balance,
  subscription facts, locally observed Tokens, capacity estimates, evidence,
  and official usage-center link without duplicating the overview.
- 5H and Weekly reset progress can be switched independently. Unlike windows
  are never added together, and provider facts, local observations, and
  derived estimates remain visibly distinct.
- Usage Center now defaults to Today. Benefit-record pagination uses the real
  row count instead of presenting a fixed four-page control.

## Providers and sign-in reliability

- Added on-device Antigravity quota discovery for Gemini, Claude, and GPT model
  windows. The discontinued Gemini Code Assist quota provider was removed;
  historical Gemini CLI usage parsing remains available.
- Added the official DeepSeek currency-balance query and linked locally observed
  DeepSeek model usage to the same account analysis.
- Kimi Code now uses the local OAuth refresh token when its access token expires
  and atomically updates the stored credentials. Running `/status` first is no
  longer required; missing or rejected refresh credentials still produce an
  actionable sign-in message.
- Updated provider contracts, security boundaries, network declarations,
  privacy documentation, and failure-isolation coverage.

## Copy, visualization, and README

- Aligned Chinese and English benefit terminology, including 5-hour rolling
  (5H rate limit) and Weekly periods, and removed Chinese leakage from English UI.
- Refined trend charts, Token attribution, capacity cards, posters, and
  responsive layouts.
- Replaced the README overview, trend, Benefit Center, and 24H/30D poster images
  with current localized screenshot sets for Chinese and English.

## Upgrade

```bash
npx @kimi.builders/usage@latest dashboard
```

Users with background sync installed should refresh its recorded package path:

```bash
npx @kimi.builders/usage@latest daemon restart
```

The upgrade does not delete local history, community connections, provider
accounts, credentials, or remote data.
