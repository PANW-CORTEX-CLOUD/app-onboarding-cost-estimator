# Architecture — Cloud Connector Cost Estimator

**Package:** `02/23`  
**Repo root:** `cloud-connector/`  
**Bill scope:** customer cloud infrastructure only (no Cortex SaaS license lines).

Related research: [CLOUD_COST_MODEL.md](./CLOUD_COST_MODEL.md) · [COST_MODEL_CHANGELOG.md](./COST_MODEL_CHANGELOG.md)

---

## Goals

- One multi-cloud estimator (**Azure + AWS + GCP**) with a **hexagonal** cost engine.
- **OpenAPI 3.1** is the REST SSOT; UI consumes generated client types only.
- Formula changes in **one provider must not** touch UI, API mapping-only handlers, or other providers.

---

## Package layout

```text
cloud-connector/
├── azure/data/                 # Azure TF inventory SSOT (unchanged)
├── aws/                        # Stub — future AWS IaC
├── gcp/                        # Stub — future GCP IaC
├── docs/
│   ├── ARCHITECTURE.md         # this file
│   ├── CLOUD_COST_MODEL.md
│   ├── COST_MODEL_CHANGELOG.md
│   └── adr/                    # architecture decision records
├── openapi/openapi.yaml        # REST contract SSOT (stub until pkg 15)
├── packages/
│   ├── cost-engine/            # Pure TypeScript — zero React/HTTP in core
│   │   └── src/
│   │       ├── core/           # GENERIC DOMAIN
│   │       │   ├── ports/      # ProviderEstimator, RatesAdapter, MeterMap
│   │       │   └── models/     # shared DTOs
│   │       └── providers/
│   │           ├── azure/
│   │           ├── aws/
│   │           └── gcp/
│   └── api/                    # Hono — OpenAPI handlers, price proxies
├── apps/
│   └── web/                    # Vite + React FSD — no formulas
└── scripts/                    # measure-plan, boundaries, handoff
```

Placeholder stubs (links must resolve):

- [`openapi/openapi.yaml`](../openapi/openapi.yaml)
- [`packages/api/README.md`](../packages/api/README.md)
- [`apps/web/README.md`](../apps/web/README.md)
- [`packages/cost-engine/src/core/ports/provider-estimator.interface.ts`](../packages/cost-engine/src/core/ports/provider-estimator.interface.ts)
- [`packages/cost-engine/src/core/ports/rates-adapter.interface.ts`](../packages/cost-engine/src/core/ports/rates-adapter.interface.ts)
- [`packages/cost-engine/src/core/ports/meter-map.interface.ts`](../packages/cost-engine/src/core/ports/meter-map.interface.ts)

---

## Hexagonal core + providers

| Zone | Path | Responsibility |
| --- | --- | --- |
| Generic core | `packages/cost-engine/src/core` | Ports, hours/proration (later), `projectCosts`, pinning, shared DTOs — **pure TS** |
| Azure | `packages/cost-engine/src/providers/azure` | EH / Blob / disks formulas + Retail Prices adapter + meter map |
| AWS | `packages/cost-engine/src/providers/aws` | Kinesis/SQS / S3 / EBS formulas + Price List adapter + meter map |
| GCP | `packages/cost-engine/src/providers/gcp` | Pub/Sub / GCS / PD formulas + Billing Catalog adapter + meter map |
| REST | `packages/api` | Zod from OpenAPI, ProblemDetails, CORS-safe proxies |
| UI | `apps/web` | FSD layers, provider selector, charts — **no formula logic** |

### Ports

#### `ProviderEstimator`

```ts
estimate(inputs: EstimateInputs, rates: RateCard): EstimateResult
```

Defined in [`provider-estimator.interface.ts`](../packages/cost-engine/src/core/ports/provider-estimator.interface.ts).

#### `RatesAdapter`

```ts
getRates(region: string): Promise<{ rates: RateCard; ratesSource; ageDays }>
```

Defined in [`rates-adapter.interface.ts`](../packages/cost-engine/src/core/ports/rates-adapter.interface.ts).

#### `MeterMap`

```ts
list(): readonly MeterMapRow[]
```

Defined in [`meter-map.interface.ts`](../packages/cost-engine/src/core/ports/meter-map.interface.ts).

---

## Dependency / import rules

### Monorepo packages

| From → To | Allowed? |
| --- | --- |
| `apps/web` → generated OpenAPI client types | Yes |
| `apps/web` → `packages/api` **source** | **No** |
| `apps/web` → `cost-engine` **internals** (`src/providers/**`, `src/core/**` deep) | **No** (public `index` only if ever needed; prefer API) |
| `packages/api` → `cost-engine` public exports | Yes |
| `cost-engine/core` → `providers/*` | **No** |
| `cost-engine/providers/azure` → `providers/aws` or `gcp` | **No** |
| `cost-engine` → `react` / `hono` | **No** |

### FSD (apps/web)

`app → pages → widgets → features → entities → shared`  
Lower layers must not import upper layers.

### Enforcement

Run boundary linter (fail closed):

```bash
node scripts/check-boundaries.mjs
```

Wired into `pnpm test` via cost-engine / root scripts.

---

## OpenAPI as SSOT

- Contract: [`openapi/openapi.yaml`](../openapi/openapi.yaml) (filled in package 15).
- Codegen: `openapi-typescript` → committed types; CI drift check later.
- Web: `openapi-fetch` only — never hand-roll paths that diverge from the YAML.
- Handlers in `packages/api` validate with Zod derived from the contract; map to engine ports — **no pricing formulas in handlers**.

---

## ADRs

### ADR-001 — Server-side price proxy (not pure SPA)

**Status:** Accepted  

**Context:** Azure Retail Prices, AWS Price List, and GCP Billing Catalog are called from browsers only with CORS/auth pain and key exposure risk.

**Decision:** `packages/api` proxies provider price APIs. SPA talks only to `/v1/*`.

**Consequences:** Need a small Node service; freshness/cache live server-side; UI shows `ratesSource` / `ageDays` from API metadata.

See [adr/001-server-side-price-proxy.md](./adr/001-server-side-price-proxy.md).

### ADR-002 — One app, three providers

**Status:** Accepted  

**Context:** Customers compare Azure/AWS/GCP Cortex infra TCO; duplicating three SPAs would fork UI and drift OpenAPI.

**Decision:** Single `apps/web` + single OpenAPI with `provider: azure|aws|gcp`; provider modules implement the same ports.

**Consequences:** Strict import boundaries so Azure formulas cannot leak into AWS/GCP or React.

See [adr/002-one-app-three-providers.md](./adr/002-one-app-three-providers.md).

---

## EDGE / anti-patterns (fail closed)

| Anti-pattern | Rule |
| --- | --- |
| Formula code in React widgets | **Forbidden** — call API only |
| Formula code in OpenAPI handlers beyond DTO mapping | **Forbidden** |
| Cross-provider imports `azure` ↔ `aws` ↔ `gcp` | **Forbidden** — boundary linter fails |
| Silent cross-provider rate mix (Azure rates on AWS estimate) | **Forbidden** — `RateCard.provider` must match estimator |
| Core importing `providers/*` | **Forbidden** |
| Deep relative imports across packages | **Forbidden** — use package exports |
| Silent fallback that invents `$0` meters | **Forbidden** (rates module) |

---

## REST surface (package 15)

| operationId | Path |
| --- | --- |
| `getHealth` | `GET /v1/health` |
| `getCapabilities` | `GET /v1/capabilities?provider=` |
| `getRates` | `GET /v1/rates?provider=&region=` |
| `refreshRates` | `POST /v1/rates/refresh` (rate-limited) |
| `createEstimate` | `POST /v1/estimates` |
| `createProjection` | `POST /v1/projections` (core `projectCosts`) |

Errors: RFC 7807 ProblemDetails. Estimate bodies: `additionalProperties: false`.
API `info.version` **0.1.0** (breaking bump from stub). Swagger UI: `/v1/docs`.
Regen types: `pnpm openapi:gen`. Spectral: `pnpm spectral`.
