# Publishing checklist

Publishing is intentionally separate from implementation. None of the commands
below publish unless the final `npm publish` command is explicitly run.

## Before a release

1. Use a clean release branch and review `git status`.
2. Confirm the public version in `package.json` and update release notes.
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

## Publish

For the scoped public package, the registry command is:

```bash
npm publish --access public
```

The package's `prepublishOnly` hook runs `release:check` again and blocks the
publish on failure. CI may add npm provenance when its identity and registry
configuration support it.

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
