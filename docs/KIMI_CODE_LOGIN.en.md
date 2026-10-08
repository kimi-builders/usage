# Kimi Code Multi-Account Quotas, Login Renewal, and Recovery

[简体中文](./KIMI_CODE_LOGIN.md)

## View the local login and multiple API keys together

Expand **Benefit Center → Benefit settings → Kimi Code**:

1. Keep **Local CLI login** to read the current CLI account at query time, without copying a token.
2. Choose **Add API-key account** for each other account. Enter a readable name and a **Kimi for Coding API key**
   created in the Kimi Code console, not a Moonshot platform key.
3. On macOS, save each key in the system Keychain, or use a separate environment-variable name per account.
   Variables must be inherited by the dashboard process. Platforms without Keychain use environment variables;
   keys are not saved in plaintext configuration.
4. Save and refresh, then use the account picker to view quotas. Each connection owns its name, credential,
   and user-declared benefit/spend details. One expired key does not hide other accounts.
   Leave an existing saved key blank to keep it.

Keys and devices belonging to one account generally share that account's plan quota.
When the response provides a verifiable account ID, the overview and quota history deduplicate those connections.
Without identity evidence, connections are not guessed to be the same account; do not add them as independent plans.
Legacy single-account settings migrate to one connection. Existing web tokens remain supported;
if an old web-token configuration actually holds a Coding API key, select the API-key connection method and re-enter it.

New plans display only officially reported windows, such as five-hour and monthly quotas. A missing weekly window
is not an error; legacy weekly quotas remain supported. Monthly windows without an explicit duration never acquire
an invented 30-day duration or a fabricated Token allowance.

### Why are historical Tokens not grouped by key yet?

Kimi CLI, OpenCode, WorkBuddy, ZCode and other clients may share the same key. Client names, model names and the
current configuration cannot prove which key a past request used. Existing scanned logs provide no reliable per-request
key identity, and the Coding quota endpoint is not a per-key Token ledger. The Benefit Center therefore keeps
Agent-level Tokens unlinked to individual Kimi accounts. Existing Usage Center Token totals remain unchanged.
A future local-only, pseudonymous key dimension requires stable request-level evidence in the source logs.
No guessed backfill or raw keys will enter records, exports, diagnostics, or community sync.

Kimi Code quotas reuse the official CLI's local login by default, taking the first
existing `credentials/kimi-code.json` in this order: `$KIMI_SHARE_DIR`, `$KIMI_CODE_HOME`,
`~/.kimi-code` (CLI 2.x), `~/.kimi` (CLI 1.x). Set `KIMI_CODE_HOME` or `KIMI_SHARE_DIR`
only when the official CLI uses a non-default home directory.

## Renewal mechanism and rotation risk

Kimi rotates refresh tokens: every renewal returns a new refresh token and invalidates
the old one. This means:

- refreshing only in this tool's memory without writing the file back would invalidate the
  refresh token the CLI has saved and break the CLI's own login;
- writing the replacement back can race with the CLI's own renewal.

This tool participates in renewal and converges on those risks:

- renewal runs serialized under a file-level process lock (except on Windows and when
  `KIMI_DISABLE_OAUTH_LOCK=1`);
- the credential file is reread while holding the lock: if the CLI published a new login in
  the meantime, that login is adopted instead of renewing again;
- when a renewal request is rejected (HTTP 400), the file is reread after a short wait and a
  replacement the CLI already rotated in is adopted;
- the write-back uses a temporary file plus an atomic rename with 0600 permissions and
  preserves fields this tool does not know about;
- access tokens are proactively renewed at least 300 seconds before expiry; a 401 from the
  quota endpoint forces one renewal and retries the query; renewal happens on demand at
  query time only, with no background process.

The official CLI remains the owner of the login. In rare cases where this tool and the CLI
renew at nearly the same moment, a single query may fail; retrying with the recovery steps
below is enough and never damages the CLI login.

## Recovering an expired login

CLI access tokens are short-lived; once the CLI quits, no process renews them and the next
query may find them expired. Then:

1. Run `kimi` to renew the login (complete the sign-in if the CLI asks);
2. Query again — this tool rereads the credential file on every query, so **restarting is
   unnecessary**;
3. For unattended use, add an API-key connection using its own environment variable or system Keychain,
   independent of the CLI file. API keys go only to the Coding quota endpoint, never to website-login
   or OAuth-renewal endpoints.

The credential file is read locally only. When troubleshooting, never paste the contents of
`credentials/kimi-code.json` into issues, chats, or the community; running `kimi` for a
fresh login is the whole recovery.
