# Local Usage — Design QA

## Visual truth

- Current community page: `/private/tmp/kb-qa-usage-top.png`
- Current community poster: `/private/tmp/kb-uni-usage-30d-zh.png`
- Local implementation: `/private/tmp/kbu-replica-top-final.png`
- Generated local poster: `/private/tmp/kbu-poster-30d-final.png`
- Page comparison: `/private/tmp/kbu-compare-top-final.png`
- Poster comparison: `/private/tmp/kbu-compare-poster-final.png`
- Export light theme: `/private/tmp/kbu-export-light.png`
- Export dark theme: `/private/tmp/kbu-export-dark.png`

The page comparison uses populated 30D/all-Agent/all-model states. The 1440 × 900 community capture was normalized to the in-app browser's 1265 × 712 content viewport before comparison. The poster comparison preserves both original 1080 × 1440 images.

## Result

No actionable P0, P1, or P2 visual issue remains.

- Desktop shell, spacing, control treatment, three-card hero, ten-metric strip, chart panels, typography, dark tokens, and light tokens match the current community implementation.
- The local navigation intentionally maps the community shell to working analytics anchors. No dead community route is presented as a local feature.
- A fresh local scan omits the community page's stale-data banner; the banner remains implemented and appears after 24 hours.
- The local poster matches the community poster's header, identity band, Token hero, flow diagram, trend band, KPI strip, Agent/model rankings, QR footer, palette, and 1080 × 1440 export contract.
- Local identity is editable and browser-local because the local dashboard has no community account identity. Project, device, and conversation content never enter the poster.

## Functional QA

- Range, Agent, model, theme, locale, calculation notes, export, refresh, share, and all analytics anchors are operational.
- CSV and JSON export render correctly in both themes. CSV values are UTF-8 BOM encoded, quoted, and protected against spreadsheet formula injection.
- Poster generation succeeded for Today, 24H, 7D, 30D, 90D, and All. Today/24H use hourly bars; 7D uses the weekday/hour heatmap; 30D uses daily stacked bars; 90D/All use a contribution calendar.
- The poster PNG is generated locally at 1080 × 1440, has a functional QR, and can be downloaded or sent through the native share sheet when supported.
- Browser console: 0 errors and 0 warnings after page, dialog, theme, and poster-range checks.
- Source choices now use the actual Collector `source` contract instead of blank option labels.
- Collector, Agent, terminal, OS, and price-catalog facts remain separate fields in the source panel.

## Responsive contract

- Under 760px the desktop rail is removed and a fixed five-item mobile navigation appears, providing access to overview, trend, activity, records, and sources.
- Header actions become an even two-column grid; Hero cards and distribution cards become a single column; KPI cells become two columns; table and heatmap retain intentional horizontal scrolling.
- Dialogs become bottom sheets, poster preview stays bounded, and share controls remain reachable below the preview.
- The in-app browser exposes a fixed viewport and Codex disallows Computer Use against its own window, so this pass could not create a new 390px runtime screenshot. The responsive rules and mobile navigation structure were inspected directly; this limitation did not require a product-code workaround or a second browser.

## Automated verification

- Collector suite: 87/87 passed.
- Dashboard suite: 6/6 passed, including range/previous-period/lifetime/model-identity analytics.
- Vite production build passed and emitted the packaged client/server artifacts.
- Build warning: the single initial JS chunk is 622 kB (192 kB gzip). It is acceptable for the local-only first release; share-poster code splitting is a future performance polish, not a correctness blocker.

## Accepted local-product differences

- Community account chrome becomes a `LOCAL` privacy status and local language/theme controls.
- Community navigation becomes working dashboard-section navigation plus explicit Community/GitHub links.
- `All` is present as requested; the community's custom date control is not copied into this local milestone.
- Community sync remains explicit and optional. Merely opening the local page performs no network request.

final result: passed
