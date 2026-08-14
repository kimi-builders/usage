# Security policy

## Supported versions

Security fixes are applied to the latest released minor version. During the
`0.4.x` public beta, users should reproduce issues on the latest `0.4.x` patch or
the repository default branch before reporting them.

## Reporting a vulnerability

Do not include Agent logs, API keys, home-directory paths, prompts, responses,
or private usage exports in a public issue. Report the smallest reproducible
case to the repository maintainers through GitHub's private vulnerability
reporting when it is enabled.

Useful redacted diagnostics (review aggregate counts before sharing):

```bash
npx @kimi.builders/usage doctor --json
```

Please include the Collector version, operating system family, affected source,
impact, and reproduction steps. The maintainers should acknowledge a report
within seven days and coordinate disclosure after a fix is available.

## Release requirements

Public releases must be produced by CI using npm Trusted Publishing/provenance,
run the full test suite on supported platforms, generate an SBOM, and contain no
postinstall script. Desktop distributions additionally require platform signing.
