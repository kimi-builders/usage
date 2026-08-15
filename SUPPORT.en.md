# Support and troubleshooting

> [中文](./SUPPORT.md)

## Choose the right report type

| Area | Example | Recommended entry point |
| --- | --- | --- |
| Parser compatibility | An Agent has data but scans as zero, or Tokens are clearly missing | Parser compatibility issue |
| Local dashboard | Blank page, chart, mobile, or export problem | Bug report issue |
| Subscription limits | Provider login detection or quota fails | Quota provider issue |
| Community sync | `init`, `sync`, checkpoint, or hosted result is wrong | Bug report issue |
| Background sync | launchd/systemd/Task Scheduler does not run | Bug report issue |
| New feature/source | A new Agent, chart, or workflow | Feature request |
| Security vulnerability | Log/credential exposure or unauthorized access | GitHub Private Vulnerability Reporting |

Repository issues: <https://github.com/kimi-builders/usage/issues>

## Before opening an issue

1. Confirm the current checkout version:

   ```bash
   node ./bin/kbu-usage.js --version
   ```

2. Run the offline health check:

   ```bash
   node ./bin/kbu-usage.js doctor
   node ./bin/kbu-usage.js doctor --json
   ```

3. For a parser problem, inspect the actual local source roots:

   ```bash
   node ./bin/kbu-usage.js inspect --dry-run
   ```

   `inspect` prints local paths. **Never paste its complete output into a public issue.**

4. For background sync, run:

   ```bash
   node ./bin/kbu-usage.js daemon status
   ```

5. Reproduce once and record the command, expected result, actual result, and time.

## Include in an issue

- Collector version and commit when running from source;
- operating-system name, version, and architecture;
- Node.js version;
- affected Agent/provider and its version;
- minimum reproduction steps;
- expected and actual behavior;
- whether it reproduces consistently and whether the Agent was recently upgraded;
- a reviewed `doctor --json` report;
- for UI issues, a redacted screenshot, viewport size, theme, and language.

## Never publish

- prompts, responses, reasoning text, or tool results;
- provider cookies, OAuth tokens, API keys, `kbu_` keys, or copied cURL;
- full HOME/project paths, repository remotes, private project/customer names;
- raw session IDs, account IDs, email addresses, or unredacted screenshots;
- the original `~/.kimi-builders/usage/config.json` file;
- complete Agent databases, JSONL, SQLite, or conversation exports.

If a minimal fixture must derive from real data, copy it to a temporary location,
remove all text and identity fields, replace every ID, path, timestamp, model, and
counter, then inspect it line by line before upload. Maintainers should never ask
for raw logs in a public issue.

## Common troubleshooting

### Dashboard does not open or reports scan failure

- From a source checkout, run `npm run setup` once and then `npm run dev`. Do not
  run `npm --prefix dashboard run dev` by itself: that starts only Vite, without
  the local data API.
- Use the complete authorized URL printed by the terminal; do not remove query parameters.
- Confirm that no firewall or security tool blocks `127.0.0.1`.
- Run `doctor` to distinguish a dashboard-server problem from one parser failure.

### One source fails

- Other sources should keep working and the failed source's old checkpoint remains.
- Record the Agent version and whether it was recently upgraded.
- Use `inspect --dry-run` to confirm the correct root was detected, but redact paths publicly.
- Do not move, modify, or delete the provider's original logs for testing.

### Subscription limits are unavailable

- Limits and the Token dashboard are independent; a quota failure does not affect local usage.
- Confirm the provider is enabled in Benefit settings and inspect “Detection details”.
- Distinguish missing setup, expired login, API drift, and temporarily unavailable.
- Environment variables must be set before starting the dashboard. Keychain mode
  can leave a secret blank to keep the existing value.
- Never paste cookies, tokens, or complete provider responses into an issue.

### Community sync fails

- Run `status` and confirm the device is connected.
- `sync` first reads community privacy settings; it cancels safely without valid settings.
- A 4xx normally indicates authorization or request failure and blind retries do not help;
  network/5xx retries are bounded.
- Only successful batches update checkpoints; one failed source does not block others.
- If remote data was deleted and should be replayed:

  ```bash
  node ./bin/kbu-usage.js reset --local
  node ./bin/kbu-usage.js sync
  ```

  This clears local incremental state and re-uploads readable history. Confirm that
  this is the intended outcome before running it.

### Background sync does not run

- Run `daemon status --json` for the scheduler, installed version, runtime path,
  and recent error.
- Run `daemon restart` after a Collector upgrade or source-checkout move.
- `daemon status` prints the log path; review paths, errors, and machine details before sharing.
- `daemon uninstall` removes only the scheduler and metadata, not local or remote history.

### npm cache permission error

If npm reports root-owned files under `~/.npm`, that is a local npm-cache problem,
not a Collector-data problem. Do not use `sudo npm` for this project. Verify with an
isolated cache first:

```bash
NPM_CONFIG_CACHE=/tmp/kbu-npm-cache npm run release:check
```

Understand the exact target before permanently changing cache ownership; never run
broad recursive ownership commands against HOME or the repository.

## Security issues

Do not open a public issue for credential exposure, loopback capability-token
bypasses, cross-Origin access, conversation/path upload, or release-supply-chain
problems. Use GitHub Private Vulnerability Reporting:

<https://github.com/kimi-builders/usage/security/advisories/new>

Use fictional credentials and a minimal reproduction. Supported versions and
response targets are documented in [SECURITY.md](./SECURITY.md).
