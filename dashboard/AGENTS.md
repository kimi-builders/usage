# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Durable product decisions

- Subscription Center is a first-class destination. Usage Center keeps only a compact health/entry strip; do not place the full quota product above Usage analytics again.
- Subscription analysis uses the complete local source history and does not inherit temporary Usage Center filters.
- Keep three data classes visually and semantically separate: provider-reported quota facts, locally observed Token usage, and derived capacity estimates.
- ChatGPT Pro, Claude Max, and similar subscriptions must not be described as having an official fixed Token cap when the provider only exposes utilization. Capacity and model-only numbers are estimates, with their window, sample quality, assumptions, and uncertainty visible.
- Actual subscription spend is user-entered. Never guess a user's plan price, discounts, tax, currency, or renewal date.
- Future recommendations must answer “what did this cost, what capacity/value did it produce, and what should I change?” with traceable evidence; they must not mutate subscriptions or credentials automatically.
- Quota history is backend-owned, sanitized, and separate from Agent usage logs. Persist only quota window facts needed for longitudinal analysis; never persist account identity, credential/source paths, raw responses, or provider errors in that history file.
- Keep quota history bounded: recent points may be 15-minute resolution, medium-term points hourly, and older points daily. A cached page read must not append a duplicate observation.
- Pace and value signals must identify their evidence window. Stale history may remain visible after a provider error, but must not produce a current-cycle forecast or prescriptive recommendation.
- Never compare CNY and USD subscription value by silently inventing an exchange rate. Show currencies separately until the user supplies or the product versions an explicit rate source.
- Cross-cycle capacity ranges may use only completed quota cycles sampled close to reset with at least 90% local-log coverage. Show the eligible-cycle count, interval method, and confidence; never promote a partial cycle into a historical range.
- Renewal forecasts require a configured renewal date, at least 10% elapsed period, and at least 90% local-log coverage. Keep actual-to-date and projected figures visibly distinct.
- Describe similar 30-day model-family distributions as workload-overlap review candidates, never as proven duplicate subscriptions. Remind users that web usage, other devices, team benefits, and non-Token features are outside the evidence.
