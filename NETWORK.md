# Network behaviour

> [中文](./NETWORK.zh.md)

There is no telemetry, update check, advertising request, or hidden background
connection. Local parsing modules do not import the network client. Background
sync exists only after an explicit `daemon install` and can be inspected or
removed with the CLI at any time.

| Command | Network | Purpose |
| --- | --- | --- |
| no arguments, `help`, `status`, `sources` | No | Local help, configuration, and capability display |
| `inspect --dry-run` | No | Show local roots and parser results |
| `doctor [--json]` | No | Redacted local compatibility report |
| `reset --local` | No | Remove local sync checkpoints |
| `init` | Yes | Device-code connection only; no usage upload unless `--sync` is explicit |
| `sync [--full]` | Yes | Read privacy settings and upload changed aggregates; `--full` explicitly replays only sources marked Local + sync |
| `daemon install/restart` | Yes, in the scheduled child | Manage a per-user OS scheduler and trigger its first incremental sync |
| `daemon status/uninstall` | No | Inspect or remove the per-user scheduler |
| scheduled `daemon run` | Yes | Run the same incremental sync while the device is awake and online |
| `summary` | Yes | Read the connected account's hosted summary |
| `dashboard` | No by default | Loopback dashboard; community connection/sync and provider quota checks require explicit browser actions |
| `npm run setup` | Yes | Explicitly install the dashboard's development dependencies from npm |
| `npm run dev` | No by default | Loopback Vite + local API; the same optional quota rules as `dashboard` apply |

For the default origin `https://kimi.builders`, the current endpoints are:

- `POST /api/usage/device/code`
- `POST /api/usage/device/token`
- `GET /api/usage/settings`
- `POST /api/usage/ingest`
- `DELETE /api/usage/ingest`
- `GET /api/usage?days=N`

`init --api-url` can point to another origin for development or self-hosting.
The Collector sends the device API key only to the configured origin. Ingest
bodies are gzip-compressed JSON; compression changes transport size, not fields.

The background service uses macOS `launchd`, Linux user `systemd`, or Windows
Task Scheduler. It stores only scheduler metadata, last-run status, a lock, and
a bounded local log under `~/.kimi-builders/usage`. It has no additional network
destinations and cannot be installed by merely opening the dashboard.

The local web dashboard binds to loopback only and uses a random per-launch
browser token, strict Host/Origin checks, a restrictive CSP, and no-store
responses. Its Token analysis stays offline. The Dashboard can request device
authorization, run one sync, manage the OS scheduler, disconnect the current
device, or delete that device's cloud history only after the user presses the
corresponding control. Subscription-limit checks are separate, disabled by
default, and contact only the provider explicitly enabled in local settings:

Quota-history recording, Token-to-quota correlation, pace forecasts, and
subscription-value observations are local computations and add no network
destinations. Cached dashboard reads do not manufacture duplicate history
points; only a fresh provider refresh can append a sanitized observation.

- Codex: `https://chatgpt.com/backend-api/wham/usage` and the optional
  `wham/rate-limit-reset-credits` companion endpoint;
- Claude Code: `https://api.anthropic.com/api/oauth/usage`;
- Kimi Code: `https://api.kimi.com/coding/v1/usages`, or
  `https://www.kimi.com/apiv2/kimi.gateway.billing.v1.BillingService/GetUsages`
  and `https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`
  when the user explicitly selects a Web token source;
- Cursor: `https://cursor.com/api/usage-summary` and the optional
  `https://cursor.com/api/auth/me` identity endpoint;
- GitHub Copilot: GitHub's device authorization endpoints
  `https://github.com/login/device/code` and `https://github.com/login/oauth/access_token`,
  account identity at `https://api.github.com/user`, then quota facts at
  `https://api.github.com/copilot_internal/user`; device authorization starts
  only after the user presses Connect and supports separately stored accounts;
- OpenCode Go: `https://opencode.ai/_server` is used to discover the signed-in
  account's Workspace, then `https://opencode.ai/workspace/{id}/go` supplies the
  rolling, weekly, and monthly subscription windows. Each saved account has its
  own user-supplied Cookie; a `wrk_…` Workspace ID is an optional override only;
- Qoder: `https://qoder.com/api/v2/me/usages/big_model_credits`, or the
  equivalent `qoder.com.cn` endpoint when the user selects the China site;
- Warp: `https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo`;
- Antigravity first reuses an already-running Antigravity or `agy` process. It
  discovers that process's listening loopback ports and sends fixed-path POSTs
  only to `127.0.0.1` for `RetrieveUserQuotaSummary`, `GetUserStatus`, or
  `GetCommandModelConfigs`. Self-signed TLS is accepted only on this fixed
  loopback boundary; the dashboard never starts or stops the process. If no
  usable local service exists, an explicitly configured OAuth source may use
  `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`,
  `v1internal:fetchAvailableModels`, and, when needed, `v1internal:retrieveUserQuota`;
  expired OAuth credentials may refresh through `https://oauth2.googleapis.com/token`;
- DeepSeek: `https://api.deepseek.com/user/balance` reads the API account's
  per-currency total, topped-up, and granted money balances with an explicitly
  configured API key. No browser session or private Platform endpoint is read;
- JetBrains AI: no network; the latest local IDE quota file is read.
Trae is visible in the setup catalog but disabled because this version has no
stable, independently verifiable subscription-quota interface for it. Merely
showing a provider in settings never causes a connection.

These are account-product surfaces rather than standard public API usage
meters. They are best-effort integrations and can change independently of the
local log parsers. Failures are isolated and never block the Token dashboard.
