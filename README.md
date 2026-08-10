# cloud-connector

Multi-cloud Cortex customer-infrastructure **cost estimator** monorepo (OpenAPI-first).

MVP ships through **package 19** (UI acceptance). See [docs/DEFINITION_OF_DONE.md](./docs/DEFINITION_OF_DONE.md).

## Requirements

- Node.js ≥ 22
- Corepack / pnpm (`packageManager` field)

## Install / build / test

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm test:e2e
```

## Local development

```bash
# Terminal A — API (OpenAPI on :8787)
pnpm --filter @cloud-connector/api start

# Terminal B — Web (Vite on :5173, proxies /v1 → API)
pnpm --filter @cloud-connector/web dev
```

Optional Docker Compose (builds `Dockerfile.dev`, API on `:8787`, web on `:5173`):

```bash
docker compose -f docker-compose.dev.yml up --build
# or: pnpm dev:docker
```

Compose sets `HOST=0.0.0.0` on the API and `API_PROXY_TARGET=http://api:8787` on Vite so the web container can reach the API service.

## Packages

| Path | Role |
| --- | --- |
| `packages/cost-engine` | Pure TS cost formulas + rates |
| `packages/api` | Hono OpenAPI REST adapter |
| `apps/web` | Vite React FSD UI (no formulas) |
| `openapi/openapi.yaml` | Contract SSOT |

## Docs

- [Architecture](./docs/ARCHITECTURE.md)
- [Cost model](./docs/CLOUD_COST_MODEL.md)
- [UI Manual QA](./apps/web/MANUAL_QA.md)
- [DoD](./docs/DEFINITION_OF_DONE.md)
