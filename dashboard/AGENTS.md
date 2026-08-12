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
