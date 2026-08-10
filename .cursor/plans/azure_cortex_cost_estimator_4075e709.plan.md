---
name: Cloud Connector Cost Estimator (Multi-Cloud Core + Azure/AWS/GCP)
overview: "DONE — OpenAPI-first multi-cloud monorepo cost estimator (cloud-connector generic engine + provider modules + Hono API + FSD UI) for Palo Alto Cortex Cloud customer infra costs. Packages 01→23 complete; MVP shippable after 19; post-MVP 20–23 (graphs, compare/share, disclaimer/tags, calibration) delivered. Auto-continue past MVP requires `plan-execute-enable.sh --through-all`."
todos:
  - id: req-research-doc
    content: "[01/23][REQ] Research doc — Document customer TCO use cases, TF inventories across Azure/AWS/GCP, Cortex capability→permission→meter maps for all 3 providers, and cite official 2026 sources (Azure Event Hubs/Disks, AWS Kinesis/S3/EBS, GCP PubSub/GCS/Disk, Retail & Price APIs). Deliverables: docs/CLOUD_COST_MODEL.md + packages/cost-engine/src/providers/{azure,aws,gcp}/capability-meter-map.ts. Keep existing azure/data TF as Azure inventory SSOT; aws/ and gcp/ stub or real TF paths documented when present"
    status: completed
  - id: ac-research-doc
    content: "[01/23][AC] Research doc — Map covers Discovery/Audit/ADS Cloud|Outpost/DSPM/Registry/Serverless for Azure, AWS, and GCP; each row lists permission signal, provider meter ID/SKU, confidence High|Med|Low, and source URL; TF defaults (Azure Standard EH, AWS Kinesis/SQS, GCP PubSub) explicitly listed; non-costs called out"
    status: completed
  - id: test-research-doc
    content: "[01/23][TEST] Research doc — Checklist: every meter cited in CLOUD_COST_MODEL.md resolves to a live official URL; TF path citations open to real files where they exist; provider meter-maps export match doc tables 1:1 (snapshot unit tests)"
    status: completed
  - id: edge-research-doc
    content: "[01/23][EDGE] Research doc — Document gaps: empty discovery TFs; missing telemetry defaults; GovCloud variances (Azure Gov vs AWS GovCloud vs GCP FedRAMP); unofficial blogs reference-only; Azure-only facts must not leak into core types"
    status: completed
  - id: req-arch-guide
    content: "[02/23][REQ] Architecture guide — docs/ARCHITECTURE.md: hexagonal multi-cloud core in packages/cost-engine/src/core (generic domain, pure TS), providers under packages/cost-engine/src/providers/{azure,aws,gcp}, OpenAPI 3.1 contract-first REST, FSD web UI, monorepo with strict dependency rules app→features→entities→shared and api→engine; ProviderEstimator + RatesAdapter + MeterMap ports. Formula changes in one provider must not touch UI or other providers"
    status: completed
  - id: ac-arch-guide
    content: "[02/23][AC] Architecture guide — Documented package layout under cloud-connector/, import rules, OpenAPI as SSOT, ProviderEstimator port (`estimate(inputs, rates)`), RatesAdapter port, ADRs for server-side proxy vs pure SPA and why one app three providers"
    status: completed
  - id: test-arch-guide
    content: "[02/23][TEST] Architecture guide — CI boundary linter fails illegal imports (ui→engine internals; engine→react; web→api implementation; cross-provider imports azure↔aws↔gcp); ARCHITECTURE.md links resolve to real paths"
    status: completed
  - id: edge-arch-guide
    content: "[02/23][EDGE] Architecture — Do not put formula code in React or OpenAPI handlers beyond mapping; no provider coupling; reject silent cross-slice imports; document anti-patterns; never silent cross-provider rate mix"
    status: completed
  - id: req-monorepo-packages
    content: "[03/23][REQ] Monorepo layout — cloud-connector/ pnpm workspace: packages/cost-engine (core + providers/{azure,aws,gcp}), packages/api (Hono), apps/web (Vite React FSD), openapi/openapi.yaml, scripts/, docs/, sources/. Keep azure/data/. Stub aws/ and gcp/ README for future IaC. Public exports via index.ts only; core has no fetch/React; optional docker-compose.dev.yml"
    status: completed
  - id: ac-monorepo-packages
    content: "[03/23][AC] Monorepo — pnpm workspaces build order engine→api→web; web depends on generated OpenAPI client types not api source; engine unit tests run without HTTP; shared modelVersion exported from engine root"
    status: completed
  - id: test-monorepo-packages
    content: "[03/23][TEST] Monorepo — package.json exports field tested; vitest projects per provider & core; boundary lint in CI; engine package.json contains no UI runtime"
    status: completed
  - id: edge-monorepo-packages
    content: "[03/23][EDGE] Monorepo — Circular deps fail CI; deep relative imports across packages banned; generated types committed with drift check; do not nest a second repo under cost-estimator/"
    status: completed
  - id: req-rates-module
    content: "[04/23][REQ] Rates module — Generic RatesAdapter interface with provider adapters: Azure Retail Prices, AWS Price List API, GCP Cloud Billing Catalog; ship fallback-prices.json per provider for eastus / us-east-1 / us-central1 in-repo"
    status: completed
  - id: ac-rates-module
    content: "[04/23][AC] Rates module — getRates(provider, region) returns typed RateCard + ratesSource live|cache|fallback + ageDays (engine/API metadata; UI banners in 17–19); fallback JSON has provider meterIds, unit, unitPrice, currency, capturedAt, sourceUrl"
    status: completed
  - id: test-rates-module
    content: "[04/23][TEST] Rates module — (1) Unit: mock provider Price API responses → parse unitPrices. (2) Offline: API error → fallback, no throw. (3) Optional live smoke per provider. (4) Assert fallback capturedAt ≤90 days or CI warns"
    status: completed
  - id: edge-rates-module
    content: "[04/23][EDGE] Rates module — Unknown region or provider → fallback + warning; multi-currency fail closed to USD in v1; empty provider response → fallback; do not invent $0 prices for missing meters"
    status: completed
  - id: req-hours-convention
    content: "[05/23][REQ] Generic hours & calendar — monthHours selectable 730 (default) vs 744 vs actual daysInMonth in core; peak factor separate from average for stream throughput across Azure EH, AWS Kinesis, GCP PubSub"
    status: completed
  - id: ac-hours-convention
    content: "[05/23][AC] Hours — Changing monthHours linearly scales hourly billing and prorated snapshot costs across all 3 providers; UI/API labels active convention; locked 730 default in core"
    status: completed
  - id: test-hours-convention
    content: "[05/23][TEST] Hours — 1 unit × rate × 730 vs 744 golden; Feb 28/29 actual days option; peak factor doubles throughput recommendation without multiplying base event volume"
    status: completed
  - id: edge-hours-convention
    content: "[05/23][EDGE] Hours — Leap year support; do not silently use 720; auto-inflate peak throughput cost separate from average utilization cost"
    status: completed
  - id: req-eh-engine
    content: "[06/23][REQ] Audit stream engine (Azure/AWS/GCP) — Provider stream estimators: Azure Event Hubs (1 TU = 1 MB/s or 1000 eps, 84GB allowance, TF 1–20 TU 7d), AWS Kinesis/SQS, GCP PubSub; min capacity 1 unit when audit enabled"
    status: completed
  - id: ac-eh-engine
    content: "[06/23][AC] Stream engine — Inputs: provider, region, ingressGB/day, peakMBps, peakEventsPerSec, retentionDays=7. Output: provisioned capacity hours, ingress events, retention overage. Org presets map to volume"
    status: completed
  - id: test-eh-engine
    content: "[06/23][TEST] Audit stream formulas vs official docs — Fixtures for Azure EH, AWS Kinesis, GCP PubSub; retention allowances and throughput bindings; audit off → $0; citations in sources/OFFICIAL_FORMULA_CHECKS.md"
    status: completed
  - id: edge-eh-engine
    content: "[06/23][EDGE] Stream engine — Peak-hour billing notes; zero ingress still bills minimum unit when audit on; partition/shard count vs pricing unit separation verified per provider; Azure Capture not in TF → no Capture meter"
    status: completed
  - id: req-storage-engine
    content: "[07/23][REQ] Audit storage engine — estimateAuditStorage() for Azure Blob LRS, AWS S3 Standard, GCP Cloud Storage Standard capacity + ops; grounded in TF audit storage definitions where present (azure/data)"
    status: completed
  - id: ac-storage-engine
    content: "[07/23][AC] Audit storage — Default floor when audit enabled; inputs for avgGB and write/read ops per month; line items tagged with provider + capability audit_logs"
    status: completed
  - id: test-storage-engine
    content: "[07/23][TEST] Audit storage — (a) audit off → $0; (b) capacityCost = GB × retail_GB_month; (c) verify rates Azure Blob / AWS S3 / GCP GCS; (d) cite pricing pages in OFFICIAL_FORMULA_CHECKS.md"
    status: completed
  - id: edge-storage-engine
    content: "[07/23][EDGE] Audit storage — No lifecycle auto-delete assumed; non-standard redundancy (GRS/ZRS/Multi-region) fails closed unless explicitly selected"
    status: completed
  - id: req-ads-engine
    content: "[08/23][REQ] ADS engine (Multi-Cloud) — Cloud Scan vs Outpost across Azure Managed Disks, AWS EBS, GCP Persistent Disks; snapshot billing on used data size prorated by lifetimeHours/730"
    status: completed
  - id: ac-ads-engine
    content: "[08/23][AC] ADS — Inputs: provider, enabled, mode Cloud|Outpost, vmCount, avgUsedDiskGB, scansPerMonth, snapshotLifetimeHours, outpostVmSku. Output: snapshot lines (Cloud) + compute lines (Outpost); confidence Med / Med-Low"
    status: completed
  - id: test-ads-engine
    content: "[08/23][TEST] ADS formulas — Used-size billing across Azure/AWS/GCP snapshots; proration golden tests; Cloud mode emits no compute line; Outpost adds compute; citations in OFFICIAL_FORMULA_CHECKS.md"
    status: completed
  - id: edge-ads-engine
    content: "[08/23][EDGE] ADS — Provisioned vs used disk warnings; incremental vs full snapshot modeling (v1 conservative full used size); zero VMs + ADS on warns; GovCloud availability rules per provider"
    status: completed
  - id: req-dspm-engine
    content: "[09/23][REQ] DSPM engine (Multi-Cloud) — estimateDspm() band for Azure/AWS/GCP data reads (blob/S3/GCS) + connector ephemeral infra; low confidence; cite Cortex permissions & onboarding docs"
    status: completed
  - id: ac-dspm-engine
    content: "[09/23][AC] DSPM — Inputs: provider, enabled, dataEstateGB, pctScanned, scansPerMonth. Output: low/expected/high band; UI displays Low confidence warning"
    status: completed
  - id: test-dspm-engine
    content: "[09/23][TEST] DSPM — (a) off → $0; (b) 2× data estate doubles expected band; (c) GovCloud restrictions enforced per provider (e.g. Azure Gov DSPM N/A per Cortex); (d) no false-precise single point without band"
    status: completed
  - id: edge-dspm-engine
    content: "[09/23][EDGE] DSPM — Empty discovery TF + zero telemetry refuse silent precision; 0 GB estate + toggle on warns; ephemeral scanner resources optional uplift flag"
    status: completed
  - id: req-registry-serverless
    content: "[10/23][REQ] Registry + serverless engines — Multi-cloud registry scan (Azure ACR, AWS ECR, GCP Artifact Registry) and serverless scan (Azure Functions, AWS Lambda, GCP Cloud Run/Functions)"
    status: completed
  - id: ac-registry-serverless
    content: "[10/23][AC] Registry/Serverless — Independent toggles per provider; inputs for image/package counts, average sizes, scan cadence; line items Medium-Low confidence"
    status: completed
  - id: test-registry-serverless
    content: "[10/23][TEST] Registry/Serverless — Isolation off→$0; costs scale with scan volume; same-region pull defaults to zero/minimal bandwidth with cross-region uplift option"
    status: completed
  - id: edge-registry-serverless
    content: "[10/23][EDGE] Registry/Serverless — Do not charge existing registry/function storage; only incremental scan pull bandwidth/ops billed; zero images + toggle on warns"
    status: completed
  - id: req-egress-crosscloud
    content: "[11/23][REQ] Egress / cross-cloud bandwidth — Model egress when Cortex collector pulls telemetry across Azure/AWS/GCP or external endpoints (e.g. Azure→GCP collector from azure/data federation); zone/region rate cards mapped"
    status: completed
  - id: ac-egress-crosscloud
    content: "[11/23][AC] Egress — Toggle Include estimated egress; bandwidth line item by provider zone/region; audit default egress GB from stream ingress; confidence Medium-Low"
    status: completed
  - id: test-egress-crosscloud
    content: "[11/23][TEST] Egress — Toggle off → $0; regional egress rate lookups for Azure/AWS/GCP; no double-counting with stream egress meters; cite official bandwidth pages"
    status: completed
  - id: edge-egress-crosscloud
    content: "[11/23][EDGE] Egress — Private Link / VPC Endpoints reduce egress—toggleable path; Unknown→exclude+warn; GovCloud bandwidth SKUs separate; never assume free cross-cloud"
    status: completed
  - id: req-volume-signals
    content: "[12/23][REQ] Multi-cloud volume signals — Universal inputs: provider, account/subscription/project count, monthly active users/sign-ins, log intensity, raw stream metric paste; BYO Event Hub / Kinesis / PubSub mode"
    status: completed
  - id: ac-volume-signals
    content: "[12/23][AC] Volume signals — Account/project counts update stream ingress and peak via elasticities in CLOUD_COST_MODEL.md; BYO mode zeros managed stream namespace/capacity lines"
    status: completed
  - id: test-volume-signals
    content: "[12/23][TEST] Volume signals — 10× account scale increases log ingress; raw metric paste overrides presets; BYO eliminates stream capacity costs across all providers"
    status: completed
  - id: edge-volume-signals
    content: "[12/23][EDGE] Volume signals — Provider log category multipliers (Azure Entra 8 categories, AWS CloudTrail/GuardDuty, GCP Audit Logs); invalid raw metric paste rejected"
    status: completed
  - id: req-rate-pinning
    content: "[13/23][REQ] Reproducible multi-cloud quotes — Pin rate card per provider; freeze estimate state with unitPrices; modelVersion semver in engine root; exports include provider, modelVersion, ratesAsOf, input hash; docs/COST_MODEL_CHANGELOG.md"
    status: completed
  - id: ac-rate-pinning
    content: "[13/23][AC] Rate pinning — Re-loading frozen JSON reproduces totals within $0.01 regardless of live provider price changes; changelog tracks rule/constant updates"
    status: completed
  - id: test-rate-pinning
    content: "[13/23][TEST] Rate pinning — Golden: freeze → mutate mock rates → re-estimate from frozen payload → totals unchanged; export schema validates provider and modelVersion"
    status: completed
  - id: edge-rate-pinning
    content: "[13/23][EDGE] Rate pinning — Corrupt freeze payload fails closed; pinned rates older than 180 days warn; modelVersion bump invalidates old pins gracefully"
    status: completed
  - id: req-formula-regression
    content: "[14/23][REQ] Official formula regression pack — sources/OFFICIAL_FORMULA_CHECKS.md + vitest suites per provider enforcing official Azure, AWS, and GCP pricing rules as executable assertions"
    status: completed
  - id: ac-formula-regression
    content: "[14/23][AC] Formula regression — Each engine formula has ≥1 assertion tied to official provider documentation URLs; test fails if capacity binding or snapshot proration regresses; README refresh procedure"
    status: completed
  - id: test-formula-regression
    content: "[14/23][TEST] Formula regression — Full vitest suite pass; optional live price smoke; golden multi-cloud fixtures (Azure, AWS, GCP) committed and verified"
    status: completed
  - id: edge-formula-regression
    content: "[14/23][EDGE] Formula regression — Live provider rates drift >30% from fallback → warn (do not auto-pass); doc updates require explicit AC test updates; never skip checks with env silent bypass"
    status: completed
  - id: req-openapi-rest
    content: "[15/23][REQ] OpenAPI 3.1 REST — Contract-first openapi/openapi.yaml. Implement projectCosts() in cost-engine core BEFORE createProjection handler. Operations: getHealth, getCapabilities, getRates, createEstimate, createProjection, refreshRates. Supports provider parameter (azure|aws|gcp). Hono validates via Zod; serves Swagger UI; server-side pricing API proxies"
    status: completed
  - id: ac-openapi-rest
    content: "[15/23][AC] OpenAPI REST — POST /v1/estimates returns lineItems+totals+confidence+provider+ratesAsOf+modelVersion; POST /v1/projections returns series+table (0% growth flat = monthly estimate); GET /v1/rates?provider=; RFC 7807 ProblemDetails; /v1 prefix; Hono+pnpm build green"
    status: completed
  - id: test-openapi-rest
    content: "[15/23][TEST] OpenAPI REST — Spectral lint clean; contract tests match schemas; openapi-typescript codegen + CI drift check; web uses openapi-fetch only; engine totals match API for same input per provider"
    status: completed
  - id: edge-openapi-rest
    content: "[15/23][EDGE] OpenAPI REST — Breaking change bumps API version; deprecated params marked; rate-limit refreshRates; fail closed on unknown fields (additionalProperties: false); never expose raw provider OData/price-list payloads to clients"
    status: completed
  - id: req-price-freshness
    content: "[16/23][REQ] Price freshness — Auto-fetch rates via API; cache with 24h TTL; stale banners when capturedAt > STALE_DAYS (7 warn / 30 critical); scripts/refresh-fallback-prices.mjs updates Azure/AWS/GCP fallbacks; CI age/drift gate"
    status: completed
  - id: ac-price-freshness
    content: "[16/23][AC] Price freshness — UI shows ratesAsOf, ratesSource live|cache|fallback, ageDays; Refresh rates forces live fetch; critical-stale fallback requires Ack before export; export embeds ratesAsOf + unitPrices"
    status: completed
  - id: test-price-freshness
    content: "[16/23][TEST] Price freshness — Cache hit skips network; expired cache refetches; API failure uses fallback with stale banner; refresh script produces valid multi-provider JSON; ageDays thresholds unit-tested"
    status: completed
  - id: edge-price-freshness
    content: "[16/23][EDGE] Price freshness — Partial provider API success fails closed for missing meters (no mix live+invented $0); CORS only via backend proxy with explicit user feedback; no silent success"
    status: completed
  - id: req-fsd-ui
    content: "[17/23][REQ] FSD UI structure — apps/web FSD layers; provider selector (Azure default, AWS, GCP); widgets: CostBreakdown, RatesFreshnessBanner, Disclaimer (ProjectionCharts stub OK until 20); features run-estimate/toggle/freeze; shared openapi-fetch client. No formulas in widgets. Role=structure+client (layout=18, E2E=19)"
    status: completed
  - id: ac-fsd-ui
    content: "[17/23][AC] FSD UI — Feature run-estimate calls createEstimate with selected provider; URL state includes provider; keyboard accessible; switching provider updates capabilities from getCapabilities"
    status: completed
  - id: test-fsd-ui
    content: "[17/23][TEST] FSD UI — Boundary linter forbids deep/cross-layer imports; component tests mock openapi-fetch; no import from packages/api/src or cost-engine providers"
    status: completed
  - id: edge-fsd-ui
    content: "[17/23][EDGE] FSD UI — Offline shows cached estimate + stale banner; API failure fails closed with retry; optional offline engine only behind explicit toggle (never silent)"
    status: completed
  - id: req-ui-ia
    content: "[18/23][REQ] UI information architecture — Single estimator route sections: (1) Cloud Provider & Region (2) Scope & Accounts (3) Capability toggles (4) Volume signals (5) Rates freshness & freeze (6) Results summary (7) Breakdown table (8) Projections (9) Compare providers/scenarios (10) Export/disclaimer. Progressive disclosure for advanced paste/calibration"
    status: completed
  - id: ac-ui-ia
    content: "[18/23][AC] UI IA — First viewport displays selected provider, monthly expected cost, and freshness chip; capability toggles trigger debounced API calls ≤300ms; projection table adjacent to charts when present"
    status: completed
  - id: test-ui-ia
    content: "[18/23][TEST] UI IA — Manual QA section checklist; a11y landmarks (main, complementary); debounce test; empty state when only discovery enabled"
    status: completed
  - id: edge-ui-ia
    content: "[18/23][EDGE] UI IA — Avoid clutter; one job per section; section-level loading skeletons and error boundaries; no full-page blank on single-section failure"
    status: completed
  - id: req-ui-app
    content: "[19/23][REQ] UI acceptance (MVP gate) — Multi-cloud E2E via OpenAPI client: provider selection, demo presets (Azure/AWS/GCP audit-only & comprehensive), breakdown, export with disclaimer+modelVersion+ratesAsOf+provider. README pnpm install/dev/test. Owns Definition of Done through package 19"
    status: completed
  - id: ac-ui-app
    content: "[19/23][AC] UI acceptance / MVP — Switching provider updates regions and meter lines; Discovery always $0; no SaaS lines; low/expected/high bands for Low-confidence capabilities; DoD checklist through 19 checked; one-click demo presets work for all three providers"
    status: completed
  - id: test-ui-app
    content: "[19/23][TEST] UI acceptance — Smoke: capability toggles update breakdown per provider; exports include meter, provider, confidence, amount, disclaimer; MANUAL_QA.md; Playwright E2E happy-path green against local api+web"
    status: completed
  - id: edge-ui-app
    content: "[19/23][EDGE] UI acceptance — Invalid inputs fail closed; critical-stale rates block export without ack; never hide Low confidence; mobile responsive; empty advanced fields use presets not silent zeros"
    status: completed
  - id: req-graphs-projections
    content: "[20/23][REQ] Continuous graphs & projections — Time-series and forward projections (1–36 months) tied to estimate outputs across Azure/AWS/GCP. Charts: stacked monthly run-rate, cumulative TCO, volume growth overlay. Consumes createProjection REST (same engine meters; no parallel UI pricing)"
    status: completed
  - id: ac-graphs-projections
    content: "[20/23][AC] Graphs & projections — 12-month default stacked + cumulative; capability color legend; hover shows period, provider, meter, amount, confidence; growth applies to volumeElastic meters; step functions for throughput units; export includes projection.series"
    status: completed
  - id: test-graphs-projections
    content: "[20/23][TEST] Graphs & projections — 0% growth flat = monthly estimate; cumulative[m]=sum(0..m); volume growth / TU-Kinesis-PubSub step functions verified; a11y table alternative with same numbers"
    status: completed
  - id: edge-graphs-projections
    content: "[20/23][EDGE] Graphs & projections — Horizon >36 rejected; negative growth floored at 0; low-confidence hatched envelope; stale rates banner above charts; do not imply reserved/CUD pricing"
    status: completed
  - id: req-scenarios-share
    content: "[21/23][REQ] Scenarios & provider comparison — Side-by-side Foundational vs Comprehensive OR Azure vs AWS vs GCP for equivalent workloads; URL query encoding for shareable links; localStorage last estimate"
    status: completed
  - id: ac-scenarios-share
    content: "[21/23][AC] Scenarios — Opening share URL restores provider, inputs, totals; side-by-side shows absolute and % delta across providers or capability tiers; no server-side PII storage"
    status: completed
  - id: test-scenarios-share
    content: "[21/23][TEST] Scenarios — Round-trip serialize/deserialize multi-cloud inputs; compare delta matches math; oversized URLs fall back to JSON export"
    status: completed
  - id: edge-scenarios-share
    content: "[21/23][EDGE] Scenarios — Malformed URL params toast warning; localStorage quota handled; no secrets in URL"
    status: completed
  - id: req-disclaimer-tags
    content: "[22/23][REQ] Disclaimer & cost allocation — Persistent UI disclaimer (exports already required in 19); managed_by tagging guidance for Azure (cortex-onboarding-*, managed_by=paloaltonetworks), AWS tags, GCP labels"
    status: completed
  - id: ac-disclaimer-tags
    content: "[22/23][AC] Disclaimer — Visible on main view and exported JSON/CSV/PDF; tagging section details provider-specific resource group/tag/label patterns"
    status: completed
  - id: test-disclaimer-tags
    content: "[22/23][TEST] Disclaimer — Export fixtures assert disclaimer string; UI a11y landmark for disclaimer; docs cite TF tags where applicable"
    status: completed
  - id: edge-disclaimer-tags
    content: "[22/23][EDGE] Disclaimer — Cannot permanently hide in v1 (session collapse OK); English baseline only"
    status: completed
  - id: req-calibration-csv
    content: "[23/23][REQ] Calibration (optional post-MVP) — Import Azure Cost Management, AWS Cost Explorer, or GCP Billing CSV; compare estimated vs actual; suggest volume calibration factors (local only)"
    status: completed
  - id: ac-calibration-csv
    content: "[23/23][AC] Calibration — Parser handles Azure/AWS/GCP billing export columns; unmatched rows listed; Apply factor scales volume presets locally without uploading data"
    status: completed
  - id: test-calibration-csv
    content: "[23/23][TEST] Calibration — Fixture CSVs for Azure/AWS/GCP parsed; apply 1.5× updates volume lines not unit prices; invalid CSV fail closed with row errors"
    status: completed
  - id: edge-calibration-csv
    content: "[23/23][EDGE] Calibration — EA/Savings Plans/CUD mean Actual < List—UI note clarifies estimates use List/Retail; mixed currencies rejected; huge files capped"
    status: completed
isProject: false
  - id: req-deps-latest
    content: "[24/25][REQ] Dependency upgrade — bump all workspace deps to latest — edge_tests_and_run_app_cda0b11e plan package 24"
    status: completed
  - id: ac-deps-latest
    content: "[24/25][AC] Dependency upgrade — bump all workspace deps to latest — edge_tests_and_run_app_cda0b11e plan package 24"
    status: completed
  - id: test-deps-latest
    content: "[24/25][TEST] Dependency upgrade — bump all workspace deps to latest — edge_tests_and_run_app_cda0b11e plan package 24"
    status: completed
  - id: edge-deps-latest
    content: "[24/25][EDGE] Dependency upgrade — bump all workspace deps to latest — edge_tests_and_run_app_cda0b11e plan package 24"
    status: completed
  - id: req-edge-hardening
    content: "[25/25][REQ] EDGE hardening — EDGE+ tests for packages 01–23 + run app — edge_tests_and_run_app_cda0b11e plan package 25"
    status: completed
  - id: ac-edge-hardening
    content: "[25/25][AC] EDGE hardening — EDGE+ tests for packages 01–23 + run app — edge_tests_and_run_app_cda0b11e plan package 25"
    status: completed
  - id: test-edge-hardening
    content: "[25/25][TEST] EDGE hardening — EDGE+ tests for packages 01–23 + run app — edge_tests_and_run_app_cda0b11e plan package 25"
    status: completed
  - id: edge-edge-hardening
    content: "[25/25][EDGE] EDGE hardening — EDGE+ tests for packages 01–23 + run app — edge_tests_and_run_app_cda0b11e plan package 25"
    status: completed
---

# Cloud Connector Cost Estimator (Multi-Cloud Core + Azure/AWS/GCP)

## Decisions locked

- **Repo root:** `[cloud-connector](.)` — one app for **Azure, AWS, and GCP**.
- **Bill scope:** customer cloud infrastructure only (no Cortex SaaS license line).
- **Layout:** generics in `packages/cost-engine/src/core`; provider specifics in `packages/cost-engine/src/providers/{azure,aws,gcp}`; REST in `packages/api`; UI in `apps/web`; OpenAPI SSOT in `openapi/openapi.yaml`.
- **Ports:** `ProviderEstimator`, `RatesAdapter`, `MeterMap` — every provider implements the same interfaces.
- **MVP gate:** packages **01–19** = shippable multi-cloud estimator (Azure + AWS + GCP formulas + rates + UI). **Post-MVP delivered:** **20** graphs/projections, **21** scenarios/share, **22** disclaimer/tags, **23** calibration CSV.
- **Stack:** pnpm, TypeScript strict, Hono (Node 22+), Vite + React 19 FSD, OpenAPI 3.1 + openapi-typescript/openapi-fetch, Zod validation, lightweight charts.
- **Execution discipline:** todos top→bottom `[01/23]`…`[23/23]`; each package **REQ → AC → TEST → EDGE** before the next. Plan status: **all-complete**.
- **Plan-execute:** default auto-continue stops after MVP (`mvpStop=19`); post-MVP requires explicit `bash scripts/plan-execute-enable.sh --through-all`.
- **Accuracy honesty:** audit streams High confidence; ADS Med; DSPM/registry/serverless Low — never present Low bands as precise quotes.
- **Existing Azure TF:** `[azure/data](azure/data)` remains SSOT for Azure onboarding inventory; do not mutate TF for the estimator.

## Architectural breakdown (`cloud-connector`)

### Folder structure

```text
cloud-connector/
├── azure/data/                      # existing Cortex Azure TF (unchanged)
├── aws/                             # stub README — future AWS connector IaC
├── gcp/                             # stub README — future GCP connector IaC
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CLOUD_COST_MODEL.md
│   ├── COST_MODEL_CHANGELOG.md
│   ├── DEFINITION_OF_DONE.md        # MVP 01–19 + post-MVP 20–23 checklist
│   └── TAGGING.md                   # cost-allocation tag/label guidance (pkg 22)
├── openapi/
│   └── openapi.yaml                 # SSOT REST Contract (OAS 3.1)
├── packages/
│   ├── cost-engine/                 # Pure TypeScript (zero React/HTTP)
│   │   ├── src/
│   │   │   ├── core/                # GENERIC CORE
│   │   │   │   ├── ports/
│   │   │   │   │   ├── provider-estimator.interface.ts
│   │   │   │   │   └── rates-adapter.interface.ts
│   │   │   │   ├── models/
│   │   │   │   │   ├── estimate.types.ts
│   │   │   │   │   ├── rate-card.types.ts
│   │   │   │   │   └── volume-signals.types.ts
│   │   │   │   ├── hours.ts
│   │   │   │   ├── project-costs.ts
│   │   │   │   └── rate-pinning.ts
│   │   │   ├── providers/
│   │   │   │   ├── azure/
│   │   │   │   │   ├── azure-estimator.ts
│   │   │   │   │   ├── azure-rates-adapter.ts
│   │   │   │   │   ├── capability-meter-map.ts
│   │   │   │   │   └── fallback-prices.json
│   │   │   │   ├── aws/
│   │   │   │   │   ├── aws-estimator.ts
│   │   │   │   │   ├── aws-rates-adapter.ts
│   │   │   │   │   ├── capability-meter-map.ts
│   │   │   │   │   └── fallback-prices.json
│   │   │   │   └── gcp/
│   │   │   │       ├── gcp-estimator.ts
│   │   │   │       ├── gcp-rates-adapter.ts
│   │   │   │       ├── capability-meter-map.ts
│   │   │   │       └── fallback-prices.json
│   │   │   └── index.ts
│   │   └── package.json
│   └── api/                         # Hono API Server
│       ├── src/
│       │   ├── adapters/
│       │   ├── handlers/
│       │   └── index.ts
│       └── package.json
├── apps/
│   └── web/                         # Vite + React 19 (FSD)
│       ├── src/
│       │   ├── app/
│       │   ├── pages/
│       │   ├── widgets/
│       │   ├── features/
│       │   ├── entities/
│       │   └── shared/              # openapi-fetch + generated types
│       └── package.json
├── sources/
│   └── OFFICIAL_FORMULA_CHECKS.md
├── scripts/
│   └── refresh-fallback-prices.mjs
└── pnpm-workspace.yaml
```

### Multi-cloud component interaction

```mermaid
flowchart TB
  subgraph UI ["apps/web Vite React FSD"]
    Page["pages/estimator"]
    ProviderSelect["widgets/ProviderSelector"]
    SharedApi["shared/api openapi-fetch"]
    Page --> ProviderSelect
    ProviderSelect --> SharedApi
  end
  subgraph API ["packages/api Hono"]
    OpenAPI["openapi/openapi.yaml SSOT"]
    Handler["POST /v1/estimates"]
    OpenAPI --> Handler
  end
  subgraph Core ["packages/cost-engine/src/core"]
    Port["ProviderEstimator"]
    RatesPort["RatesAdapter"]
    Projector["projectCosts"]
  end
  subgraph Providers ["packages/cost-engine/src/providers"]
    AzureEngine["AzureEstimator"]
    AWSEngine["AWSEstimator"]
    GCPEngine["GCPEstimator"]
  end
  subgraph Adapters ["Rates adapters"]
    AzureRates["Azure Retail API"]
    AWSRates["AWS Price List API"]
    GCPRates["GCP Billing Catalog"]
    Fallback["fallback-prices.json"]
  end
  SharedApi -->|REST /v1| Handler
  Handler --> Port
  Handler --> Projector
  Port -->|azure| AzureEngine
  Port -->|aws| AWSEngine
  Port -->|gcp| GCPEngine
  AzureEngine --> AzureRates
  AWSEngine --> AWSRates
  GCPEngine --> GCPRates
  AzureRates --> Fallback
  AWSRates --> Fallback
  GCPRates --> Fallback
```



### Division of responsibilities


| Zone             | Location                        | Responsibilities                                                                                                                                   |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Generic core** | `packages/cost-engine/src/core` | `ProviderEstimator`, `RatesAdapter`, hours/proration, `projectCosts`, rate pinning/`modelVersion`, shared DTOs/confidence bands                    |
| **Azure module** | `providers/azure`               | Event Hubs TU math (1 MB/s or 1000 eps, 84 GB/TU), Blob LRS, Managed Disk snapshots, Retail Prices adapter, map from `azure/data` TF               |
| **AWS module**   | `providers/aws`                 | Kinesis shard-hours + SQS, S3 Standard, EBS snapshots + Outpost EC2, Price List adapter, CloudTrail/GuardDuty→meter map                            |
| **GCP module**   | `providers/gcp`                 | Pub/Sub volume + storage, GCS Standard + Class A/B ops, Persistent Disk snapshots + GCE scanner, Billing Catalog adapter, Audit Logs/SCC→meter map |
| **REST**         | `packages/api`                  | OpenAPI Zod validation, ProblemDetails, CORS-safe price proxies, `/v1/`* routes                                                                    |
| **UI**           | `apps/web`                      | Provider selector, FSD layers, charts/export — **no formula logic**                                                                                |


### Multi-provider capability and billing map


| Capability  | Azure                                       | AWS                                   | GCP                               | Confidence |
| ----------- | ------------------------------------------- | ------------------------------------- | --------------------------------- | ---------- |
| Discovery   | $0 (`cortex-reader`)                        | $0 (IAM ReadOnly)                     | $0 (IAM Viewer)                   | High       |
| Audit logs  | EH Standard TU + ingress + overage >84GB/TU | Kinesis shard-hours + ingress GB + S3 | Pub/Sub GB + storage overage      | High       |
| ADS Cloud   | Snapshot GB-mo × (lifetimeHours/730)        | EBS snapshot same proration           | PD snapshot same proration        | Medium     |
| ADS Outpost | Snapshots + scanner VM                      | Snapshots + EC2                       | Snapshots + GCE                   | Medium–Low |
| DSPM        | Blob reads + ephemeral RG compute           | S3 GET/LIST + ephemeral EC2           | GCS Class B + ephemeral compute   | Low        |
| Registry    | ACR pull/transfer                           | ECR pull/transfer                     | Artifact Registry pull/transfer   | Medium–Low |
| Serverless  | Functions package copy/ops                  | Lambda/S3 package reads               | Cloud Functions/Run artifact copy | Low        |


### REST surface (`/v1`)


| operationId        | Method path                     | Description                              |
| ------------------ | ------------------------------- | ---------------------------------------- |
| `getHealth`        | GET /v1/health                  | Liveness                                 |
| `getCapabilities`  | GET /v1/capabilities?provider=  | Capability/meter maps                    |
| `getRates`         | GET /v1/rates?provider=&region= | RateCard + freshness                     |
| `refreshRates`     | POST /v1/rates/refresh          | Live pull from provider price APIs       |
| `createEstimate`   | POST /v1/estimates              | Monthly line items + totals + confidence |
| `createProjection` | POST /v1/projections            | 1–36 month series + period table         |


Request bodies include `provider: azure | aws | gcp`. Errors: RFC 7807 `ProblemDetails`. `additionalProperties: false` on estimate bodies.

## Execution order (mandatory)

**Rule:** Implement todos **strictly top-to-bottom**. Each package **REQ → AC → TEST → EDGE**. Do not start N+1 until N EDGE is complete.

```mermaid
flowchart TD
  P01[01 Research] --> P02[02 Architecture]
  P02 --> P03[03 Monorepo]
  P03 --> P04[04 Rates]
  P04 --> P05[05 Hours]
  P05 --> P06[06 Streams]
  P06 --> P07[07 Storage]
  P07 --> P08[08 ADS]
  P08 --> P09[09 DSPM]
  P09 --> P10[10 Registry serverless]
  P10 --> P11[11 Egress]
  P11 --> P12[12 Volume]
  P12 --> P13[13 Pinning]
  P13 --> P14[14 Formula regression]
  P14 --> P15[15 OpenAPI]
  P15 --> P16[16 Freshness]
  P16 --> P17[17 FSD UI]
  P17 --> P18[18 UI IA]
  P18 --> P19[19 MVP gate]
  P19 --> P20[20 Graphs]
  P20 --> P21[21 Scenarios]
  P21 --> P22[22 Disclaimer]
  P22 --> P23[23 Calibration]
```




| Phase             | Packages | Goal                                                                                      | Status        |
| ----------------- | -------- | ----------------------------------------------------------------------------------------- | ------------- |
| **P0 Foundation** | 01–03    | Multi-cloud research + architecture + monorepo                                            | **complete**  |
| **P1 Engine**     | 04–14    | Rates (3 providers), hours, all capability formulas, volume, pinning, official regression | **complete**  |
| **P2 API**        | 15–16    | OpenAPI + `projectCosts` + freshness                                                      | **complete**  |
| **P3 UI MVP**     | 17–19    | FSD + IA + multi-cloud acceptance — **MVP exit**                                          | **complete**  |
| **P4 Insights**   | 20–21    | Graphs + provider/scenario compare                                                        | **complete**  |
| **P5 Trust**      | 22–23    | Disclaimer polish + calibration                                                           | **complete**  |


**Hard dependencies**

- 04 Rates before 06–11 meter math.
- 05 Hours before stream/ADS proration.
- **15 must implement `projectCosts` in core before `createProjection` AC.**
- 15 before 16–17 (typed client + RateCard freshness).
- 17 = structure; 18 = IA; 19 = E2E MVP — no formulas in any.
- MVP stop line after **19**; continue 20–23 only with through-all opt-in (or explicit user request) — **20–23 now complete**.

## Definition of done (full plan = packages 01–23)

SSOT checklist also lives in [`docs/DEFINITION_OF_DONE.md`](../../docs/DEFINITION_OF_DONE.md).

### MVP (01–19)

- [x] Packages 01–19 EDGE green; `pnpm test` + spectral + boundary lint pass
- [x] Provider switcher Azure/AWS/GCP; each produces real estimate line items (not stubs)
- [x] Demo presets audit-only + comprehensive per provider
- [x] Export JSON includes `provider`, `modelVersion`, `ratesAsOf`, `disclaimer`
- [x] `docs/ARCHITECTURE.md` + `CLOUD_COST_MODEL.md` + `OFFICIAL_FORMULA_CHECKS.md` with `checkedAt`
- [x] No Cortex SaaS line; no silent stale-price export; no cross-provider rate mix

### Post-MVP (20–23)

- [x] **20** Graphs & projections — 1–36 month series, cumulative/volume views, stale banner
- [x] **21** Scenarios & share — provider or tier compare, `?s=` URL restore, localStorage last share
- [x] **22** Disclaimer & tags — session-only collapse, `docs/TAGGING.md` cites
- [x] **23** Calibration CSV — Azure/AWS/GCP local import, volume factor apply (no upload)

## MVP and execution principles

1. **Top-to-bottom:** 01→19 for MVP; 20–23 post-MVP — **all packages complete**.
2. **Provider readiness:** Azure is baseline from `azure/data` TF; AWS and GCP get **full** schemas, rates adapters, and formula implementations in Phase 1 (same packages 04–14) — not deferred stubs for MVP. IaC stubs remain under `aws/` and `gcp/` README only.
3. **No UI calculation logic:** formulas only in `packages/cost-engine`.
4. **Reproducibility first:** every estimate includes `modelVersion`, `ratesAsOf`, `provider`, and input hash.

## Out of scope (v1)

- Cortex Cloud SaaS / license pricing
- Mutating `azure/data` Terraform
- Cloud hosting / auth (local `pnpm dev` + optional Docker)
- OAuth into customer Cost Management / Cost Explorer / Cloud Billing APIs (CSV calibration only)
- Multi-currency FX (USD list/Retail only; fail closed otherwise)
- Server-side persistence of customer estimates

