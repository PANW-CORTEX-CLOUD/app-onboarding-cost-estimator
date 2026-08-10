# `sources/`

Official formula citations and third-party references for the cost model.

- `OFFICIAL_FORMULA_CHECKS.md` — golden formula citations (packages 06–14)
- Provider Retail / Price List / Billing Catalog capture notes live here when rates land (package 04)

Do not put pricing formulas in UI or OpenAPI handlers — cite here, implement in `packages/cost-engine`.

## Refresh procedure (package 14 AC)

When updating formulas, rates, or official URLs:

1. Edit the engine formula / constant under `packages/cost-engine/src/providers/…`.
2. Update the matching row in `OFFICIAL_FORMULA_CHECKS.md` and set **`checkedAt`** to today (UTC).
3. Update `packages/cost-engine/src/providers/formula-regression/registry.ts` if the official URL or check id changed (catalog test requires every registry URL to appear in the markdown).
4. Refresh golden fixtures under `packages/cost-engine/src/providers/formula-regression/fixtures/` when expected totals change — AC tests must be updated explicitly (do not delete assertions).
5. Run `pnpm test` (fail closed). Optional live smoke: `LIVE_PRICE_SMOKE=1 pnpm test`.
6. Never set `SKIP_FORMULA_CHECKS` / `FORMULA_CHECKS_SKIP` / `SKIP_OFFICIAL_FORMULA_CHECKS` — those env vars fail the suite (EDGE).
7. Note rule/constant bumps in `docs/COST_MODEL_CHANGELOG.md` when `modelVersion` changes.
