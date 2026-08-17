# Project documentation

> [中文](./README.md)

If this is your first time working on the project, read in this order:

1. [Development roadmap](./ROADMAP.en.md): current status, next priorities, and acceptance criteria.
2. [Local/community boundary](./PRODUCT_BOUNDARY.en.md): where capabilities belong and privacy rules that cannot be crossed.
3. [Local snapshot v1](./LOCAL_SNAPSHOT_V1.en.md): Token, session, time, pricing, and sync contracts.
4. [Source compatibility matrix](./SOURCE_COMPATIBILITY.en.md): maturity, evidence, and known boundaries for each Agent.
5. [Contributing](../CONTRIBUTING.en.md): environment, layout, change requirements, fixtures, and pull-request checks.
6. [Support and troubleshooting](../SUPPORT.en.md): collect safe diagnostics and file an issue.

Trust and release documentation:

- [Privacy boundary](../PRIVACY.md)
- [Network destinations](../NETWORK.md)
- [Threat model](../THREAT_MODEL.md)
- [Security policy](../SECURITY.md)
- [Publishing checklist](../PUBLISHING.md)
- [0.5.2 release notes](./RELEASE_NOTES_0.5.2.en.md)
- [0.5.1 release notes](./RELEASE_NOTES_0.5.1.en.md)
- [0.5.0 release notes](./RELEASE_NOTES_0.5.0.en.md)
- [0.4.1 release notes](./RELEASE_NOTES_0.4.1.en.md)
- [0.4.0 release notes](./RELEASE_NOTES_0.4.0.en.md)
- [License](../LICENSE) and [attribution](../NOTICE)

## Maintenance reminders

These changes require corresponding documentation updates:

| Change | Also update |
| --- | --- |
| New Agent parser or read directory | README, compatibility matrix/fixture, PRIVACY, and NOTICE when needed |
| New quota provider or domain | NETWORK, PRIVACY, THREAT_MODEL, provider fixture, NOTICE |
| New upload field or changed meaning | Local snapshot, protocol tests, site contract, privacy copy |
| Token/time/cost definition | Local snapshot, calculation copy, shared Collector/site tests |
| Daemon behavior or platform support | README, NETWORK, SUPPORT, three-platform descriptor tests |
| Packaged dependency, font, or icon | Package lock, NOTICE, npm-pack audit |
| Release version | Release notes, PUBLISHING, SBOM, provenance, clean checkout, and three-platform smoke tests |

When adding or changing public documentation, maintain the matching Chinese and
English editions. LICENSE and NOTICE remain single legal/attribution texts.

When unsure what to do next, return to [ROADMAP: Current conclusion](./ROADMAP.en.md#current-conclusion).
