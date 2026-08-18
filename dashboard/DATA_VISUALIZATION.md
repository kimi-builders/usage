# Dashboard Data Visualization

This Dashboard mirrors the Kimi Builders community Usage Center while keeping
all local attribution private. The implementation contract lives in
`src/styles.css`, `src/UsageCharts.jsx`, `src/UsageAttributionSummary.jsx`, and
`src/tool-glyphs.js`.

## Visual grammar

- Use `#007CFF` as the single focus or leading series.
- Render comparison bars with the neutral ramp, not unrelated status colors.
- Use the official blue sequential scale for heatmaps.
- Keep grid lines dotted and low contrast.
- Put a direct value label on the visible peak.
- State source, time window, and attribution coverage in analytical sections.

## Brand marks

Agent marks come from `@lobehub/icons-static-svg` through `ToolGlyph`.
`inline` is the default context, `chart` normalizes marks to a 16 px optical
box, and `badge` provides a 20 px identity frame. Kimi uses the black badge
treatment shared with the community application.

## Data trust

- Agent, model, project, and pair attribution are calculated from the same
  selected local fact buckets.
- Pair shares use only attributable rows; coverage badges expose the share of
  all selected Tokens that could be attributed.
- Missing projects remain missing and are never inferred.
- Cost is an API-equivalent estimate, not a subscription invoice.
- No local project attribution is published by this Dashboard.
