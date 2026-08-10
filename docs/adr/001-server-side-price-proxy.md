# ADR-001: Server-side price proxy (not pure SPA)

- **Status:** Accepted
- **Date:** 2026-07-28
- **Package:** 02/23 Architecture

## Context

Azure Retail Prices, AWS Price List, and GCP Cloud Billing Catalog cannot be safely or reliably called from a browser-only SPA (CORS, credentials, quota, and key exposure).

## Decision

Implement price fetches behind `packages/api` as authenticated/server-controlled proxies. The web app consumes only `/v1/rates` and `/v1/rates/refresh`.

## Consequences

- Requires a Node 22+ API process in every environment that needs live rates.
- Cache TTL, stale banners, and fallback JSON live server-side / in engine adapters.
- Pure-SPA offline demo still possible via committed `fallback-prices.json` served through the API.
