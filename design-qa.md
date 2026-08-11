# Local Usage Dashboard — Design QA

## Source and prototype evidence

- Current community desktop, full-page sequence: `/private/tmp/kb-live-desk-01.png` through `/private/tmp/kb-live-desk-06.png`
- Current community desktop montage: `/private/tmp/kb-live-desk-grid.png`
- Current community top: `/private/tmp/kb-live-desk-top.png`
- Community calculation, export, share, and filter states:
  - `/private/tmp/kb-live-method.png`
  - `/private/tmp/kb-live-export.png`
  - `/private/tmp/kb-live-share.png`
  - `/private/tmp/kb-live-filter-agent.png`
- Local desktop top: `/private/tmp/kbu-local-desk-top.png`
- Local calculation dialog: `/private/tmp/kbu-local-method.png`
- Local share dialog and poster: `/private/tmp/kbu-local-share.png`
- Local records and column selector: `/private/tmp/kbu-local-records.png`
- Local light-theme export: `/private/tmp/kbu-local-export-light.png`
- Current top comparison: `/private/tmp/kbu-top-compare.png`
- Refined activity heatmap, peak hover state: `/private/tmp/kbu-polished-heatmap-hover.png`
- Reference/prototype heatmap comparison: `/private/tmp/heatmap-comparison.png`
- Brand Agent icons in light theme: `/private/tmp/kbu-polished-icons-optimized.png`
- Final 1080 × 1440 poster render: `/private/tmp/kbu-polished-poster-final.png`
- Seven-day poster with the refined 7 × 24 heatmap: `/private/tmp/kbu-polished-poster-7d.png`
- Community 24H trend, natural-week, and activity references:
  - `/private/tmp/kb-source-24h-trend.png`
  - `/private/tmp/kb-source-weekly.png`
  - `/private/tmp/kb-source-heat.png`
- Local 24H trend, detailed tooltip, activity, and borderless records:
  - `/private/tmp/kbu-local-24h-trend-after.png`
  - `/private/tmp/kbu-local-trend-tooltip.png`
  - `/private/tmp/kbu-local-heat-after.png`
  - `/private/tmp/kbu-final-records.png`
- Same-viewport source/prototype comparisons:
  - `/private/tmp/kbu-trend-compare.png`
  - `/private/tmp/kbu-heat-compare.png`
- Current community/local share-card baseline at the same 1280 × 720 dialog viewport:
  - `/private/tmp/source-share-dialog-24h-final.png`
  - `/private/tmp/local-polished-share-24h.png`
- Range-specific local poster checks:
  - `/private/tmp/local-polished-share-7d.png`
  - `/private/tmp/local-polished-share-all.png`
- Keyboard-focusable metric explanation state:
  - `/private/tmp/local-metric-tooltip-final-after-reload.png`

The source repository was inspected read-only for the current mobile shell, filter disclosure, stacked record cards, bottom navigation, and responsive breakpoints. No community-site file was modified.

## Functional result

- Six standard ranges work: Today, 24H, 7D, 30D, 90D, and All.
- Agent, model, project, reasoning effort, Agent version, and device are multi-select filters with staged Apply/Cancel behavior and removable active chips.
- Trend metrics switch between Token, standard-API cost, and active time. The current range uses the same adaptive SVG stack, grid, labels, seven-slot average, hit-rate breakdown, and detailed tooltip as the community implementation; the natural-week chart intentionally remains Token-only like the community source.
- 24H is exactly 24 consecutive local-hour slots (including the current partial hour), uses date + hour labels across midnight, and no longer crashes when switching from a day-based range. A render error boundary prevents any future chart failure from becoming a blank page.
- The activity heatmap switches between Token, cost, time, and user messages. It now distinguishes observed zeroes from collection gaps, uses a six-step blue ramp, marks the selected-metric peak with a white glow, and exposes a keyboard-accessible detailed tooltip with Token legs, hit rate, cost, active time, and user messages. TOP 5 follows the chosen metric.
- Agent/model/project/device distributions independently switch between Token and cost and show both share and API-equivalent value.
- Records switch between daily and 30-minute grain, support seven optional columns, paginate at 25 rows, and become mobile cards below 760px. Agent and hit-rate cells are plain, borderless table content; Agent brand marks retain their source artwork without a surrounding frame.
- Export distinguishes current-filter CSV from all-history private JSON, shows exact counts and truncation state, applies CSV formula-injection protection, and renders correctly in dark and light themes.
- Calculation notes include formulas, time semantics, comparison semantics, pricing coverage, and the current log-model-to-price match table.
- Share poster generation succeeds locally at 1080 × 1440 and supports all six ranges, editable local identity, PNG download, and native share.
- Local posters no longer emit a QR code or a localhost/community URL that a recipient cannot open. The shared footer is now a local/private provenance seal plus pricing and privacy notes.
- Poster main views now specialize by range: hourly/four-part stacks for Today and 24H, a 7 × 24 activity matrix for 7D, a daily four-part stack with 7-day average for 30D, a 13-week footprint for 90D, and a 26-week footprint for All. Month/weekday labels, Y-axis values, heat legends, peak marks, colored Agent artwork, weekly streak, and zero-input leverage fallback are explicit.
- Every equal-period change shown in the hero/stat cards is hover- and keyboard-focusable and explains the current value, previous value, comparison window, formula, and result. Cache quality explains the formula, current value, thresholds, and cost implication.
- Agent identity uses the maintained LobeHub brand SVG set (color variants where available) across filters, distributions, records, source health, and poster output. Mono-only brands retain a colored frame and remain legible in both themes.
- The poster Agent section now carries brand marks, rank, Token share, and per-Agent accent bars; the bottom insight row separates top model from recorded reasoning intensity and reasoning Token volume.
- Device/source panels use actual terminal, OS, Collector, and Agent-version fields; local-only and community-sync boundaries are explicit.
- The desktop activity grid now fits all 24 columns without horizontal scrolling at the 1280px reference viewport (`clientWidth === scrollWidth === 624px`). Mobile retains intentional horizontal scrolling below 760px.
- Mobile has a sticky top bar, full navigation drawer, fixed five-item bottom bar, one-column actions/cards, horizontally scrollable charts/heatmap, stacked record cards, and bottom-sheet dialogs.

## Automated verification

- Full Collector/dashboard suite: 94/94 passed.
- Dashboard/Sites suite: 11/11 passed.
- Production build passed and emitted `dist/client`, `dist/server`, and hosting metadata.
- Runtime assertions passed on real local data: 24 hourly hit zones, zero Recharts nodes, non-empty React root, no desktop heatmap/trend overflow, and transparent/zero-width Agent and hit-rate framing.

## Current request visual check

The current community 24H poster and the local 24H poster were captured in the same 1280 × 720 in-app-browser dialog viewport. The local version retains the site's hierarchy, proportions, flow/chart density, metric band, Agent/model section, and range controls, while deliberately replacing the public-site QR footer with truthful local-only provenance.

24H, 7D, 30D, and All poster previews were rendered from real local data; Today and 90D share the already-verified hourly and footprint primitives. The metric explanation trigger was checked with keyboard focus as a real rendered tooltip. Community source files remained read-only.

The earlier full-dashboard mobile runtime comparison remains tracked separately because the automation viewport cannot be reduced below 760px; it does not block this poster-and-tooltip scope.

final result: passed
