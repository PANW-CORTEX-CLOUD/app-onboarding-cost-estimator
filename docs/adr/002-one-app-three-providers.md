# ADR-002: One app, three providers

- **Status:** Accepted
- **Date:** 2026-07-28
- **Package:** 02/23 Architecture

## Context

Customers need comparable Cortex customer-infra TCO across Azure, AWS, and GCP. Three separate apps would triplicate UI, OpenAPI, and auth while inviting formula drift.

## Decision

Ship **one** `apps/web` and **one** OpenAPI contract with `provider: azure | aws | gcp`. Provider-specific math lives only under `packages/cost-engine/src/providers/{azure,aws,gcp}` implementing shared ports.

## Consequences

- Boundary lint must fail cross-provider and UI→engine-internal imports.
- Region catalogs and meter maps are provider-scoped; never silently mix rate cards across providers.
- Feature flags / capability toggles are shared UX with provider-specific line items.
