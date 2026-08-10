# Definition of Done — full plan (packages 01–23)

MVP gate is packages **01–19**. Packages **20–23** are post-MVP (graphs, compare/share, disclaimer/tags, calibration).

## MVP (01–19)

- [x] Packages 01–19 EDGE green; `pnpm test` + spectral + boundary lint pass
- [x] Provider switcher Azure/AWS/GCP; each produces real estimate line items (not stubs)
- [x] Demo presets audit-only + comprehensive per provider
- [x] Export JSON includes `provider`, `modelVersion`, `ratesAsOf`, `disclaimer`
- [x] `docs/ARCHITECTURE.md` + `CLOUD_COST_MODEL.md` + `OFFICIAL_FORMULA_CHECKS.md` with `checkedAt`
- [x] No Cortex SaaS line; no silent stale-price export; no cross-provider rate mix

## Post-MVP (20–23)

- [x] **20** Graphs & projections — 1–36 month series, cumulative/volume views, stale banner
- [x] **21** Scenarios & share — provider or tier compare, `?s=` URL restore, localStorage last share
- [x] **22** Disclaimer & tags — session-only collapse, `docs/TAGGING.md` cites
- [x] **23** Calibration CSV — Azure/AWS/GCP local import, volume factor apply (no upload)

## How to verify

```bash
pnpm install
pnpm test
pnpm test:e2e
pnpm --filter @cloud-connector/api start   # :8787
pnpm --filter @cloud-connector/web dev     # :5173 (proxies /v1)
```

## Plan-execute auto-continue

```bash
bash scripts/plan-execute-enable.sh              # through MVP only
bash scripts/plan-execute-enable.sh --through-all # past MVP until all-complete
bash scripts/plan-execute-disable.sh
```
