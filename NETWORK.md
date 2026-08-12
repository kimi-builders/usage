# Network behaviour

There is no telemetry, update check, advertising request, or hidden background
connection. Local parsing modules do not import the network client.

| Command | Network | Purpose |
| --- | --- | --- |
| `help`, `status`, `sources` | No | Local configuration and capability display |
| `inspect --dry-run` | No | Show local roots and parser results |
| `doctor [--json]` | No | Redacted local compatibility report |
| `reset --local` | No | Remove local sync checkpoints |
| `init` | Yes | Device-code connection, then first explicit sync |
| `sync` | Yes | Read privacy settings and upload changed aggregates |
| `summary` | Yes | Read the connected account's hosted summary |
| `dashboard` | No by default | Loopback dashboard; optional provider quota checks are opt-in per provider |
| `npm run setup` | Yes | Explicitly install the dashboard's development dependencies from npm |
| `npm run dev` | No by default | Loopback Vite + local API; the same optional quota rules as `dashboard` apply |

For the default origin `https://kimi.builders`, the current endpoints are:

- `POST /api/usage/device/code`
- `POST /api/usage/device/token`
- `GET /api/usage/settings`
- `POST /api/usage/ingest`
- `GET /api/usage?days=N`

`init --api-url` can point to another origin for development or self-hosting.
The Collector sends the device API key only to the configured origin. Ingest
bodies are gzip-compressed JSON; compression changes transport size, not fields.

The local web dashboard binds to loopback only and uses a random per-launch
browser token, strict Host/Origin checks, a restrictive CSP, and no-store
responses. Its Token analysis stays offline. Subscription-limit checks are
separate, disabled by default, and contact only the provider explicitly enabled
in local settings:

- Codex: `https://chatgpt.com/backend-api/wham/usage` and the optional
  `wham/rate-limit-reset-credits` companion endpoint;
- Claude Code: `https://api.anthropic.com/api/oauth/usage`;
- Kimi Code: `https://api.kimi.com/coding/v1/usages`, or the Kimi Web billing
  endpoints when the user explicitly selects a Web token source;
- Cursor: `https://cursor.com/api/usage-summary` and the optional
  `https://cursor.com/api/auth/me` identity endpoint;
- GitHub Copilot: `https://api.github.com/copilot_internal/user`;
- OpenCode: `https://opencode.ai/_server`, using only the workspace and
  subscription server functions needed for quota windows;
- Qoder: `https://qoder.com/api/v2/me/usages/big_model_credits`, or the
  equivalent `qoder.com.cn` endpoint when the user selects the China site;
- Warp: `https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo`;
- Gemini CLI: `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota`;
- Antigravity: `https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist`,
  `v1internal:fetchAvailableModels`, and, when needed, `v1internal:retrieveUserQuota`;
  expired OAuth credentials may refresh through `https://oauth2.googleapis.com/token`;
- JetBrains AI: no network; the latest local IDE quota file is read.
- Windsurf: no network in this version; the local `state.vscdb` quota cache is
  read after the user enables the provider.

Trae is visible in the setup catalog but disabled because this version has no
stable, independently verifiable subscription-quota interface for it. Merely
showing a provider in settings never causes a connection.

These are account-product surfaces rather than standard public API usage
meters. They are best-effort integrations and can change independently of the
local log parsers. Failures are isolated and never block the Token dashboard.
