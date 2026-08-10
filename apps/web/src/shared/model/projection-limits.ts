/**
 * Mirror of packages/cost-engine/src/core/project-costs.ts
 * PROJECTION_MAX_MONTHS - the canonical value also enforced by the API's
 * zod schema (packages/api/src/schemas.ts) and documented in
 * openapi/openapi.yaml's CreateProjectionRequest.months.maximum.
 *
 * apps/web deliberately cannot import cost-engine internals directly (see
 * web-no-engine-internals-or-api-src in scripts/check-boundaries.mjs - the
 * UI consumes generated OpenAPI types only), so this is a manually-kept-in-
 * sync literal rather than an import. Was previously 3 separate inline `36`
 * literals in ProjectionCharts.tsx; now a single named constant.
 */
export const PROJECTION_MAX_MONTHS = 36;
