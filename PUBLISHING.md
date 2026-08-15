# Publishing checklist

> [中文](./PUBLISHING.zh.md)

Public releases are produced only by `.github/workflows/release.yml`. The
workflow runs on GitHub-hosted runners, requests an OIDC identity, verifies the
supported platform matrix, preserves CycloneDX SBOMs and the reviewed tarball,
then publishes with provenance. After the one-time bootstrap release it uses
npm Trusted Publishing and has no stored npm write token.

After the first release, configure `@kimi.builders/usage` on npmjs.com with a
GitHub Actions trusted publisher for repository `kimi-builders/usage`, workflow
filename `release.yml`, and the `npm publish` action. The repository URL in
`package.json` must match that public GitHub repository exactly.

An unpublished package has no npm package-settings page on which to create that
trust relationship. The first release therefore uses one short-lived granular
access token as a bootstrap credential:

1. Confirm that the `kimi.builders` npm organization exists and that the
   releasing account may create public packages in its scope.
2. Create a granular token with read/write access to the `@kimi.builders` scope,
   bypass 2FA enabled, and the shortest practical expiry.
3. Add it to the public GitHub repository as the Actions secret
   `NPM_FIRST_PUBLISH_TOKEN`. Never put the value in Git, an issue, or a log.
4. Publish the first GitHub release using the normal workflow below.
5. As soon as `@kimi.builders/usage` exists, configure its trusted publisher,
   delete the GitHub secret, and revoke the bootstrap token. Later releases use
   OIDC only; the workflow does not require a stored npm token.

## Before a release

1. Use a clean release branch and review `git status`.
2. Confirm the public version in `package.json` and update the matching Chinese
   `docs/RELEASE_NOTES_<version>.md` and English
   `docs/RELEASE_NOTES_<version>.en.md` release notes.
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
TARBALL="$(npm pack --ignore-scripts --silent --pack-destination /tmp/kbu-usage-release-artifact)"
mkdir -p /tmp/kbu-usage-install-smoke
cd /tmp/kbu-usage-install-smoke
npm init -y
npm install --ignore-scripts "/tmp/kbu-usage-release-artifact/$TARBALL"
./node_modules/.bin/kbu-usage --version
./node_modules/.bin/kbu-usage doctor --json
```

Start `dashboard --no-open` only long enough to confirm the authorized loopback
URL and page shell, then stop it. Do not run `init`, `sync`, or `daemon install`
in this smoke directory. Remove both temporary directories and the worktree
after the evidence has been reviewed.

## Publish

1. Confirm the public GitHub remote exactly matches the `repository.url` in
   `package.json`, push the reviewed release commit to `main`, and wait for CI.
2. For the first release only, confirm `NPM_FIRST_PUBLISH_TOKEN` is installed as
   described above. For later releases, confirm it is absent and the npm trusted
   publisher still maps `@kimi.builders/usage` to GitHub repository
   `kimi-builders/usage` and workflow `release.yml`.
3. Create a GitHub release whose tag is exactly `v<package.json version>`.
4. Publishing the GitHub release starts the protected npm workflow. Review its
   platform gates, package audit, SBOM artifacts, and npm provenance result.
5. After the first release, complete the trusted-publisher migration and token
   revocation before starting any further release work.

Do not publish public versions from a developer workstation. `prepublishOnly`
remains a final local safeguard, but it is not a replacement for the CI release
identity or the cross-platform gates.

## After a release

```bash
npx @kimi.builders/usage@latest --version
npx @kimi.builders/usage@latest doctor
npx @kimi.builders/usage@latest dashboard
```

Existing background-service users should run:

```bash
npx @kimi.builders/usage@latest daemon restart
```

That refreshes the absolute package/runtime path recorded by the user-level OS
scheduler. It does not delete local history, the community connection, or
remote data.
