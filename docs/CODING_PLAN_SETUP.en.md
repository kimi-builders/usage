# Connect GLM, MiniMax, and Alibaba plans

[中文](./CODING_PLAN_SETUP.md)

All three integrations live in the local Dashboard under **Benefit Center → Benefit settings → All platforms**,
and start disabled. Expand the card, choose your plan's China or international region, then enable, configure, and save.
“Detected” means a credential was found, not that the query succeeded; check the resulting quota status after saving.

| Provider | Credential | Current coverage |
| --- | --- | --- |
| GLM / Z.ai | Personal Coding Plan API key for the selected region | Official multi-window utilization/resets and separate MCP quota |
| MiniMax | Coding / Token Plan API key, typically `sk-cp-…` | Model/service quota, verifiable weekly windows, and resets |
| Alibaba Coding Plan | Console Cookie for the selected region | Official five-hour, weekly, and monthly request quotas |

## Setup

On macOS, select manual configuration and paste the credential; it is saved in Keychain, not browser storage or plain configuration JSON.
On other systems, set an environment variable before starting the Dashboard. The card takes the **variable name**, not the secret value.

GLM and MiniMax: follow the official link in the card, sign in to your personal plan, and obtain its API key.
A pay-as-you-go key may not read subscription quotas; do not substitute a team key for a personal plan key.

Alibaba: follow the official console link → browser developer tools, Network → refresh the Coding Plan page →
find `queryCodingPlanInstanceInfoV2` → copy its `Cookie` request header or the request as cURL.
Only the literal Cookie is read; **the cURL command is never executed**. A normal DashScope key cannot replace this Cookie.
Never post the Cookie in an issue, chat, or community page. Sign in again and replace it when it expires.

Default environment names (custom names are also supported):

| Provider | China | International |
| --- | --- | --- |
| GLM / Z.ai | `GLM_API_KEY` | `Z_AI_API_KEY` |
| MiniMax | `MINIMAX_CODING_API_KEY` | `MINIMAX_CODING_API_KEY_GLOBAL` |
| Alibaba | `ALIBABA_CODING_PLAN_COOKIE` | `ALIBABA_CODING_PLAN_COOKIE_GLOBAL` |

After saving, refresh in the Dashboard or run `kbu-usage quota --provider glm`,
`kbu-usage quota --provider minimax`, or `kbu-usage quota --provider alibaba-coding`.

## Boundaries and troubleshooting

- One selected region per provider is queried at a time. Keychain credentials, benefit classification, price, and renewal date are stored separately by region.
  Switching clears unsaved credential input. If you use custom environment names, ensure they point to the intended region's credential.
- Changing a key/Cookie starts a new quota-history series rather than joining an old account's observations to a new one.
- Credentials are not retried across regions. On an authentication error, check the region and plan-key type before replacing the secret.
- GLM's `TOKENS_LIMIT` is not a raw Token cap; MCP stays separate. MiniMax's `usage_count` means remaining.
  Zero count placeholders in percentage-only responses do not mean unused quota.
- Missing quota does not mean free, unlimited, or unused. Unknown windows get no fabricated progress bars.
- Local request-to-plan attribution is not established, so these providers do not automatically receive local Token totals, capacity estimates, or low-value conclusions.
  The Usage Center still counts all supported local Agents normally.
- GLM team scopes, Alibaba's newer personal/team Token Plan, simultaneous multiple accounts, and MiniMax billing history are not included.
  These are best-effort integrations; protocol drift produces an error, not guessed data. Credentials only go to official hosts listed in [Network behaviour](../NETWORK.md).
