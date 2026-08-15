# Contributing

> [中文](./CONTRIBUTING.md)

Thank you for helping improve Kimi Builders Usage. This project touches local
developer logs and account quotas, so correctness, privacy, and explainability
come before the number of integrations or development speed.

## Before you start

1. Read the [README](./README.en.md), [product boundary](./docs/PRODUCT_BOUNDARY.en.md),
   and [local snapshot contract](./docs/LOCAL_SNAPSHOT_V1.en.md).
2. Choose work from the P0/P1 sections of the [roadmap](./docs/ROADMAP.en.md), a
   small documentation issue, or an existing issue.
3. Open a design issue before implementing large protocol changes, new sources,
   new network destinations, or product-boundary changes.
4. Never commit real conversations, credentials, full paths, or unredacted user data.

## Local environment

Node.js 20 or newer is required.

```bash
git clone https://github.com/kimi-builders/usage.git
cd usage
npm run setup
npm run dev
```

To keep the browser closed:

```bash
npm run dev -- --no-open
```

Core checks:

```bash
npm test
npm run dashboard:build
npm run dashboard:test
```

Complete release gate:

```bash
npm run release:check
```

Tests must isolate themselves with environment variables, temporary directories,
and fixtures; they must not read the developer's real HOME. If manual verification
uses real local data, do not paste its output or screenshots directly into an
issue or pull request.

## Repository layout

```text
bin/                       CLI entry point
src/parsers/               Local Agent log parsers
src/local/                 Snapshot, metrics, pricing, and loopback server
src/limits/                Subscription catalog, credentials, and providers
src/sync*.js / api.js      Community protocol, incremental sync, and status
src/daemon.js              launchd / systemd / Task Scheduler
dashboard/src/             React dashboard and share posters
test/                      Collector, protocol, security, and platform tests
dashboard/tests/           Dashboard analytics and packaging tests
docs/                      Data contracts, product boundaries, and roadmap
```

## Requirements by change type

### Parser or new Agent source

- Read only fixed, documented directories. `roots()` must support test overrides
  and must never fall back to the real HOME after an override fails.
- Add a minimal redacted fixture, never a complete real session.
- Cover current/legacy formats, empty data, malformed rows, deduplication, time,
  mutually exclusive Token categories, and source failure.
- Preserve the raw model name. Set `modelCanonical`, provider, reasoning effort,
  or version only when evidence supports it.
- Never backfill historical request facts from the current CLI setting or version.
- Update the README source table, compatibility matrix, PRIVACY/NETWORK when
  applicable, and NOTICE when code or material was adapted.

### Subscription-limit provider

- Document whether the API is public, where credentials come from, which domains
  are allowed, and why access is needed.
- Providers are off by default. A failure must be isolated from the Token dashboard
  and other providers.
- Raw credentials and responses must never reach the browser, logs, exports,
  snapshot, or community sync.
- Test success, authentication failure, API drift, missing quota, and malformed
  data with redacted fixtures.
- Update `NETWORK.md`, `PRIVACY.md`, the threat model, setup copy, and NOTICE.
- If an interface is unstable or cannot be independently verified, show it as
  unavailable instead of generating guessed data.

### Local dashboard and posters

- Keep every task usable on desktop and narrow screens; one standard screenshot
  is not sufficient verification.
- Interactions must support keyboards. Dialogs manage focus and Escape; charts
  provide explanatory tooltips or copy.
- Do not add remote scripts, fonts, images, or telemetry. Production assets are
  bundled locally.
- Exports must defend against CSV formula injection and explain fields in private JSON.
- Posters must not contain localhost URLs, unusable QR codes, projects, devices,
  paths, or conversation content.
- Verify visual work in both themes, both languages, empty states, and large values.

### Sync, protocol, or daemon

- Do not blindly retry 4xx responses. Network/5xx retries must be bounded.
- Commit checkpoints only after successful batches; partial/skipped/failed sources
  retain previous state.
- Validate new protocol fields locally and on the server, with privacy denying by default.
- Daemons must be user-level, inspectable, restartable, and removable. Opening the
  dashboard must not install one.
- Platform commands need descriptor tests that do not touch real schedulers.
- Upgrade, deletion, revocation, and replay behavior must agree across CLI, UI, and docs.

### Pricing and model catalog

- Use official standard API prices and record source URL, verification date, and
  effective range.
- Never treat batch/flex/priority or long-context prices as the default standard tier.
- Preserve Tokens from unmatched models as unpriced; never count them as $0.
- Add tests spanning price-effective dates and cost conservation.

## Privacy checklist

Before submitting, verify:

- [ ] No prompts, responses, reasoning text, tool results, or file contents.
- [ ] No real cookies, tokens, API keys, emails, account IDs, or full paths.
- [ ] No undocumented read location, environment variable, network domain, or upload field.
- [ ] Local-only capabilities were not accidentally tied to community login or sync.
- [ ] `doctor --json` remains safe for public issues and new errors redact paths.
- [ ] Browser responses, exports, and logs exclude raw provider credentials/responses.

## Fixture rules

- Use obviously fictional accounts, projects, IDs, models, and timestamps.
- Keep only the minimum fields needed to trigger behavior; remove conversation text.
- Session IDs must not come from real users; credentials must be unusable test strings.
- Use fixed time and expected totals instead of `Date.now()`-dependent assertions.
- If a fixture comes from a third-party open-source project, verify its license and
  update NOTICE.

## Commits and pull requests

- One pull request should solve one clear problem. Do not mix formatting,
  refactoring, and new functionality.
- Use concise Conventional Commit messages, for example:

  ```text
  fix(codex): preserve reasoning tokens across fork replay
  feat(limits): add provider quota fixture
  docs: add parser compatibility matrix
  ```

- A pull request must describe the problem, implementation, privacy/network
  impact, verification, and relevant platform/UI screenshots.
- State whether it changes the protocol, read paths, network targets, config
  schema, NOTICE, or package contents.
- Do not commit generated `dashboard/dist/`; release builds regenerate it.

## Attribution and sources

When adapting code, protocol mappings, fixtures, or substantial interactions:

1. Record the project, URL, license, and affected files.
2. Distinguish code adaptations, product references, and packaged dependencies.
3. Update [NOTICE](./NOTICE); do not describe observation as co-ownership or a
   material adaptation as mere inspiration.
4. Confirm that the license is compatible with this project's distribution.

## Conduct

Respect maintainers and reporters; discuss technical facts rather than identity.
Do not ask users to publish sensitive logs to prove a problem, and do not encourage
bypassing a provider's security controls. Report security issues through the
private channel described in [SUPPORT.en.md](./SUPPORT.en.md), not a public issue.
