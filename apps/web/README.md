# `apps/web`

Vite + React 19 FSD UI for the multi-cloud cost estimator (MVP through package 19).

## Install / dev / test

From repo root:

```bash
pnpm install
pnpm --filter @cloud-connector/web dev
pnpm --filter @cloud-connector/web test
pnpm --filter @cloud-connector/web test:e2e
pnpm --filter @cloud-connector/web build
```

Vite proxies `/v1` → `API_PROXY_TARGET` (default `http://127.0.0.1:8787`; Compose uses `http://api:8787`). Start API separately or via Playwright webServer / `docker compose -f docker-compose.dev.yml up --build`.

## FSD layers

`app → pages → widgets → features → entities → shared`

## MVP features (package 19)

- Demo presets: Azure/AWS/GCP × audit-only & comprehensive
- Export JSON/CSV/PDF with provider, modelVersion, ratesAsOf, disclaimer
- Critical-stale export requires explicit ack
- Low-confidence bands; Discovery $0; no SaaS lines
- [MANUAL_QA.md](./MANUAL_QA.md)
