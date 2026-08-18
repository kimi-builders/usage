/* Kimi chart palette. Token composition stays in one sequential blue family;
   status pastels are reserved for health, warning, and risk states. Values are
   CSS custom properties so dark/light themes share the same chart grammar. */
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
