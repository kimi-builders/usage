# Publishing checklist

Public releases are produced only by `.github/workflows/release.yml`. The
workflow runs on GitHub-hosted runners, requests an OIDC identity, verifies the
supported platform matrix, preserves CycloneDX SBOMs and the reviewed tarball,
then publishes through npm Trusted Publishing with provenance. It has no npm
write token.

Before the first release, configure `@kimi-builders/usage` on npmjs.com with a
GitHub Actions trusted publisher for repository `kimi-builders/usage`, workflow
filename `release.yml`, and the `npm publish` action. The repository URL in
`package.json` must match that GitHub repository exactly.

## Before a release

1. Use a clean release branch and review `git status`.
2. Confirm the public version in `package.json` and update the matching release
   notes (for `0.4.0`: `docs/RELEASE_NOTES_0.4.0.md`).
3. Run the complete local gate:

   ```bash
   npm run release:check
   ```

   This runs Collector tests, builds and tests the dashboard, and executes
   `npm pack --dry-run` so the exact public file list is visible.

4. Verify the three background-service descriptors without installing them:

   ```bash
   node --test test/daemon.test.js
   ```

5. Smoke-test the package from a temporary directory. Do not reuse a real
   Collector config when testing connection or upload flows.

## Clean-checkout verification

The release candidate is not proven by a dirty maintainer checkout. Create a
temporary checkout from the exact release commit, install with lockfiles, and
run the gate there:

```bash
git worktree add /tmp/kbu-usage-release-check HEAD
cd /tmp/kbu-usage-release-check
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix dashboard --ignore-scripts --no-audit --no-fund
npm run release:check
```

Then pack the exact candidate, install that tarball into a separate empty
directory, and check only local/offline entry points:

```bash
npm pack --ignore-scripts --pack-destination /tmp/kbu-usage-release-artifact
mkdir -p /tmp/kbu-usage-install-smoke
cd /tmp/kbu-usage-install-smoke
npm init -y
npm install --ignore-scripts /tmp/kbu-usage-release-artifact/kimi-builders-usage-0.4.0.tgz
./node_modules/.bin/kbu-usage --version
./node_modules/.bin/kbu-usage doctor --json
```

Start `dashboard --no-open` only long enough to confirm the authorized loopback
URL and page shell, then stop it. Do not run `init`, `sync`, or `daemon install`
in this smoke directory. Remove both temporary directories and the worktree
after the evidence has been reviewed.

## Publish

1. Push the reviewed release commit to `main` and wait for CI to pass.
2. Create a GitHub release whose tag is exactly `v<package.json version>`.
3. Publishing the GitHub release starts the protected npm workflow. Review its
   platform gates, package audit, SBOM artifacts, and npm provenance result.

Do not publish public versions from a developer workstation. `prepublishOnly`
remains a final local safeguard, but it is not a replacement for the CI release
identity or the cross-platform gates.

## After a release

```bash
npx @kimi-builders/usage@latest --version
npx @kimi-builders/usage@latest doctor
npx @kimi-builders/usage@latest dashboard
```

Existing background-service users should run:

```bash
npx @kimi-builders/usage@latest daemon restart
```

That refreshes the absolute package/runtime path recorded by the user-level OS
scheduler. It does not delete local history, the community connection, or
remote data.
