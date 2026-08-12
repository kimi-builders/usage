# Threat model

## Assets

- local Agent logs and project identity;
- the installation-local session salt;
- the per-device `kbu_` API key;
- optional provider subscription credentials and quota metadata;
- private usage aggregates and hosted account history;
- the integrity of community leaderboards and work-usage claims.

## Trust boundaries

1. Provider-owned files are untrusted input and are opened read-only.
2. Parsers convert them into the local snapshot v1 contract.
3. Upload validation isolates malformed records before network transmission.
4. The hosted API validates the protocol again and owns public-visibility rules.

## In scope

- malformed, oversized, truncated, or concurrently-written Agent logs;
- accidental upload of prompts, paths, credentials, or project identity;
- one parser failing without blocking or deleting another source's state;
- symlink/path surprises while discovering provider stores;
- a hostile web page trying to reach the loopback dashboard endpoints;
- quota credentials accidentally entering browser responses, exports, logs, or sync;
- API-key disclosure in logs or diagnostics;
- fabricated local aggregates submitted to community rankings;
- dependency and release-pipeline compromise.

## Controls already present

- no runtime dependencies and no install script;
- deny-by-default project upload;
- salted one-way session identifiers;
- per-source failure isolation and checkpoint protection;
- local and server protocol validation;
- bounded timestamps, strings, counters, batch sizes, and activity slices;
- privacy-safe `doctor --json` output.
- provider endpoint allowlisting, opt-in quota checks, and OS-keychain storage
  for supported manual credentials;

## Local web UI controls

- loopback-only listener chosen by the OS on a random high port;
- random per-launch capability token in the initial URL;
- reject non-loopback peers and unexpected Host/Origin values;
- restrictive CSP, no remote scripts/fonts/images, and no CORS wildcard;
- no file-serving route and no user-controlled path resolution;
- response headers disabling caching of private data;
- graceful shutdown and a visible statement that the process is local;
- tests for DNS rebinding, CSRF, cross-origin fetches, and token reuse.
- POST settings routes require the capability cookie, expected Host/Origin, and
  JSON content type; request bodies are size-bounded.
- quota fetch errors are provider-scoped and do not alter local Token facts.

## Ranking limitation

Open-source release provenance proves which source produced an official package;
it does not prove that local logs or uploaded usage are true. Community rankings
must remain recognition rather than settlement. Financial rewards, credits, or
proof-of-work claims require independent provider-backed metering.

## Out of scope

- a machine already controlled by malware or another user with equal filesystem
  permissions;
- falsified provider logs created by the device owner;
- provider billing correctness;
- recovery of source logs deleted by the provider or user.
