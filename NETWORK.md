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

For the default origin `https://kimi.builders`, the current endpoints are:

- `POST /api/usage/device/code`
- `POST /api/usage/device/token`
- `GET /api/usage/settings`
- `POST /api/usage/ingest`
- `GET /api/usage?days=N`

`init --api-url` can point to another origin for development or self-hosting.
The Collector sends the device API key only to the configured origin. Ingest
bodies are gzip-compressed JSON; compression changes transport size, not fields.

The planned local web dashboard will bind to loopback only. It must add a random
per-launch browser token, strict Host/Origin checks, and DNS-rebinding protection
before it can be considered ready for public release.
