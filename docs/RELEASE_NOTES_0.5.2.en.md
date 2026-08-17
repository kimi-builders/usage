# Kimi Builders Usage 0.5.2

> [中文](./RELEASE_NOTES_0.5.2.md)

`0.5.2` polishes local-Dashboard visual preferences, benefit-settings
reliability, and the OpenCode Go multi-account model. It does not change a
user's selected local scan or community-sync scope.

## Dashboard visuals and interaction

- Added a persistent Vibe visual-style switch while preserving the existing
  light/dark theme and language preferences.
- Aligned sidebar, filter, dialog, benefit-card, and small-screen states and
  dimensions; fixed long-dialog overflow, obscured actions, and expanded cards
  that broke the provider grid.
- Dialogs no longer close after an accidental backdrop click. The close button
  and Escape request confirmation when edits are unsaved.
- Extracted benefit settings into a focused component and hardened legacy or
  invalid local settings so they cannot crash the Dashboard.

## OpenCode Go account benefits

- Account name, Cookie, `wrk_…` Workspace ID, benefit type, actual price,
  currency, billing cycle, and renewal date now form one indivisible OpenCode
  Go account configuration.
- Quota lookup requires complete, valid connection facts for each account.
  New accounts never inherit another account's Workspace or subscription data.
- Legacy provider-level subscription data migrates once to the previously
  active account, preventing duplicated multi-account spend.
- The benefit overview counts OpenCode Go benefit types and actual monthly
  spend per account. Local Tokens remain counted once per Agent source because
  the underlying logs cannot reliably identify the account that produced them.

## Save and refresh experience

- “Save & refresh quotas” saves settings, refreshes quotas, and keeps the dialog
  open for checking additional accounts.
- “Save & close” saves, refreshes, and returns to Subscription Center. Success
  and failure feedback stays close to the actions that triggered it.
- Improved credential dirty-state detection, field-level validation, and
  provider-failure navigation. A saved Cookie is no longer reported missing
  after reload.

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
