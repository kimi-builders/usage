/* Chart palette — aligned with the kimi.builders usage center:
   input = brand blue, cache read = emerald, output = paper, reasoning = amber.
   Values are CSS custom properties (defined per theme in styles.css) so SVG
   fills must receive them via inline style, never a presentation attribute. */
export const CHART_COLORS = Object.freeze({
  input: 'var(--chart-input)',
  cacheWrite: 'var(--chart-cache-write)',
  cache: 'var(--chart-cache)',
  output: 'var(--chart-output)',
  reasoning: 'var(--chart-reasoning)',
  average: 'var(--chart-average)',
});

export const CONSUMPTION_PALETTE = Object.freeze([
  CHART_COLORS.input,
  CHART_COLORS.cache,
  CHART_COLORS.output,
  CHART_COLORS.reasoning,
]);
