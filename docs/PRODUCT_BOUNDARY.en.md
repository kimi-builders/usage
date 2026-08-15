# Local and community editions: product and trust boundaries

> [中文](./PRODUCT_BOUNDARY.md)
>
> Decision status: current product principle. Changing these boundaries requires
> corresponding README, PRIVACY, NETWORK, protocol-test, and UI-copy updates; it
> must never happen silently as an ordinary refactor.

Kimi Builders Usage serves two product contexts: private analysis on one computer
and a multi-device community experience on kimi.builders. They share the Collector
and metric definitions, but are not an incomplete free edition and complete cloud edition.

## 1. Core principle

```text
Value from the user's own local data → fully available locally
Value that requires a network or relationships → provided by the community
Credentials, public identity, or background behavior → off by default and explicitly authorized
```

A complete local edition is the foundation of community trust. The community does
not force login by withholding personal analytics; its distinct value comes from
multi-device history, public identity, rankings, achievements, work associations,
and cohort benchmarks.

## 2. Current capability split

| Capability | Local edition | kimi.builders community |
| --- | --- | --- |
| Multi-Agent scan and common contract | Complete | Receives aggregates; never scans remotely |
| Tokens, cost, time, trends, weeks, heatmaps | Complete | Complete, merged across devices |
| Model, project, reasoning, Agent-version filters | Available locally | Available for uploaded dimensions |
| Records and CSV/JSON export | Complete and generated locally | Account-history export |
| Share poster | Generated locally, no localhost QR | Can provide a publicly reachable share entry |
| Standard API price estimate | Versioned local catalog | Versioned server catalog |
| Subscription limits | Direct from this machine to selected provider | Never receives credentials or quota responses |
| Single-device history | Complete | Complete |
| Continuous multi-device history | Not applicable | Core capability |
| Public profile, achievements, Token rankings | Not applicable | Core capability, controlled by account visibility |
| Work-build rankings and associations | Not applicable | Community capability |
| Discussion, follows, developer identity | Not applicable | Community capability |
| Background sync | User-level local scheduler | Receive only; cannot pull |

## 3. Three completely separate data channels

### Local Token dashboard

- Enabled by default, no account or network required.
- Reads only known Agent directories and Cursor CSV files explicitly supplied by the user.
- The local HTTP service listens only on loopback and uses a random capability token per launch.
- Rescanning refreshes the local snapshot; it never installs a daemon or uploads.

### Subscription limits

- Global switch and every platform are off by default.
- Credentials prefer the provider's existing local login. Manual secrets use an
  environment variable or system keychain where supported.
- The browser receives normalized quota windows, never raw cookies, tokens, or provider responses.
- Quota data never enters the Token snapshot, exports, posters, or community sync.

### Community sync

- The user must authorize a device locally or with `init`; authorization is not upload.
- Each Agent has a per-device Off / Local only / Local + sync policy. New sources
  never enter sync automatically.
- One-shot `sync` and the daemon use identical privacy trimming, validation, and checkpoints.
- Checkpoints bind to an irreversible fingerprint of the community address and device
  credential. If the target cannot be proven identical, incremental sync stops;
  only CLI `sync --full` or a second dashboard confirmation may replay sources
  marked Local + sync.
- The community cannot instruct the Collector to read a new directory, enable a
  provider, or upload a new field.
- Project upload is off by default. A successful sync does not enable public profiles or rankings.

## 4. What belongs locally

Prefer local implementation if any condition applies:

- it relies only on logs already on the machine or a file explicitly exported by the user;
- the result is necessary for understanding personal data rather than created by social relationships;
- it involves provider credentials, cookies, quota responses, or private record detail;
- it can work offline without sacrificing correctness or experience;
- open, auditable code materially improves trust.

Therefore Token calculations, pricing, filters, records, charts, private exports,
subscription limits, and local posters must not be placed behind cloud login.

## 5. What belongs in the community

The community is a better boundary when:

- multiple devices require long-term merging and server persistence;
- the feature needs public identity, a reachable URL, follows, or reputation;
- it depends on cross-user comparison, percentiles, rankings, or work relationships;
- abuse prevention, visibility control, revocation, and account lifecycle are required;
- a single-machine static version has no real value.

The community's signature value should not be a mirror of local statistics. It
should develop continuous multi-device history, Token and work-build rankings,
Agent/model benchmarks, achievements, verifiable public shares, and work context.

## 6. Non-negotiable safety and experience rules

- Opening the local dashboard must not sync, install a service, or contact a provider.
- The cloud cannot remotely configure scan paths, quota credentials, or daemons.
- The upload protocol has no field for prompts, responses, reasoning text, tool
  results, file contents, or full paths.
- Provider cookies, OAuth tokens, API keys, keychain values, and raw quota responses
  never enter the browser, exports, or sync.
- Project upload and public visibility cannot be bundled into one authorization.
- Deleting remote data must not look like deleting local data; checkpoint/replay
  consequences must be explicit.
- Standard API estimates must show coverage and assumptions and must not impersonate bills.
- New local read surfaces require documentation, fixtures, and privacy tests.
- Rankings are community recognition, not provider-certified bills, productivity,
  or proof of work.

## 7. Deliberate differences

| Context | Local choice | Reason |
| --- | --- | --- |
| Identity | `LOCAL` and a browser-local poster name | Full use without a community account |
| Navigation | Local analysis anchors plus explicit community entry | Do not show community routes that cannot work |
| Poster | No QR code or localhost link | Recipients cannot access this machine |
| Freshness | Explicit rescan | Do not imply the page runs in the background |
| Device | Real terminal, OS, Collector, and Agent versions | Do not fabricate device names from AI sources |
| Quota | Queried directly by the local service | Credentials and responses never enter community sync |
| Custom dates | Not currently implemented | Common ranges first; reassess from demand |

## 8. Boundary checklist for new features

Before implementation, answer:

1. Where does the data originate: local logs, provider API, community account, or public data?
2. Does the user deserve this personal-data value without signing in?
3. Does it add a read path, environment variable, cookie, network domain, or upload field?
4. Does it continue after the page closes? Who installs, inspects, and removes that behavior?
5. Will anything become public, can it be revoked, and could it reveal projects, devices, or activity patterns?
6. If both editions implement it, which is the source of truth and how is metric drift prevented?
7. Must `PRIVACY.md`, `NETWORK.md`, the snapshot, protocol version, or threat model change?

Without these answers, the feature is not ready for development.

## 9. Near-term direction

The priority is not reducing the local edition. It is improving consistency and
the community's additive value:

- prevent Collector/site drift with shared fixtures and contracts;
- make the community deliver multi-device, ranking, achievement, and work insight
  that cannot exist locally;
- make local connection, sync, revocation, and recovery transparent to beginners;
- keep provider quotas fully local while improving compatibility and failure explanations;
- maintain public-package supply-chain quality with cross-platform CI, contract tests,
  SBOM, and provenance.

See [ROADMAP.en.md](./ROADMAP.en.md) for the execution order.
