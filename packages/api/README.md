# `@cloud-connector/api`

Hono REST adapter implementing `openapi/openapi.yaml` (package 15).

- Maps OpenAPI DTOs to cost-engine ports only — **no pricing formulas**
- Zod `.strict()` mirrors `additionalProperties: false`
- RFC 7807 Problem Details on 4xx/429
- Swagger UI at `/v1/docs`
- `refreshRates` rate-limited; responses never include raw OData / price-list payloads

```bash
pnpm --filter @cloud-connector/api test
pnpm --filter @cloud-connector/api build
```
