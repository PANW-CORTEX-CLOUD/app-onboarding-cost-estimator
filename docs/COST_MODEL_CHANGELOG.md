# Cost model changelog

## 2026-08-10c - registry scanning bills real egress; sizing fails closed

Research settled what a registry scan actually costs: Microsoft states there is
no per-GB charge for pulling images, and the same holds for ECR and Artifact
Registry. A registry's SKU and storage are infrastructure the customer already
runs, so onboarding adds only network egress, and only across regions.

`acr-pull-bandwidth`, `ecr-data-transfer` and `artifact-registry-egress` are
retired; registry scanning bills the verified egress meters instead. Same-region
scanning is $0. With this and the DSPM change, **Azure and AWS no longer price
anything from a number the vendor does not publish**.

Retired meters leave the rate files but keep their ledger rows behind a
`retired` flag, so the finding stays on the record and the crawler keeps
re-checking it — if a vendor ever introduces such a meter, we find out.

An enabled capability with no sizing input at all is now refused rather than
quoted at $0 (`providers/capability-drivers.ts`). An explicit zero is still
priced, because that is a decision rather than a gap.

No modelVersion bump: retiring an unbilled meter and refusing an unsizeable
request change no correct total.

## 2026-08-10b - DSPM priced per operation, not per gigabyte

DSPM multiplied an estate size in GB by a per-10,000-operations rate. Object
stores charge scanning per API call and hot/standard tiers have no retrieval
fee at all, so the old figure was dimensionally meaningless and far too high -
a 51,200 GB estate at 25% scanned moved from $51.20 to $1.31 per month.

Estate GB now converts to an object count via a new `avgObjectSizeMB` input
(default 4 MB, always stated in the notes), and the estimate bills one read
operation per object plus `ceil(objects / pageSize)` list operations. Every
meter used was already verified against the vendor price lists; a new
`blob-hot-lrs-list-10k` ($0.05/10K) was added and live-verified.

Also: `egress` was billed by all three estimators but declared in no capability
map or doc, because `CapabilityId` did not include it. Declared now, and a new
meter-closure test drives real estimates and asserts every emitted meter is
both declared and validated - the invariant that would have caught it.

No `modelVersion` bump for the egress declaration; the DSPM formula change is a
correction of a defect rather than a re-rating, and the old number was not
defensible in any case.

## 2026-08-10 — price validation ledger, TF-derived capability gating

Rates corrected against the providers' own price lists (Azure Retail Prices API,
AWS Price List API, GCP pricing docs):

- `blob-hot-lrs-write-10k` 0.055 → **0.05** (Azure retail: Hot LRS Write Operations)
- `s3-put-10k` 0.005 → **0.05** (repo held the per-1,000 price under a per-10k id)
- `s3-get-10k` 0.0004 → **0.004** (same 10x unit error)
- `gcs-standard-storage` 0.020 → **0.022** (us-central1 Standard)
- `pubsub-message-delivery` 0.04 → **0.0390625** (official SKU is $40/TiB)

Four meters were found not to exist in any vendor price list
(`acr-pull-bandwidth`, `s3-data-retrieval-band`, `pd-snapshot-storage`,
`gcs-data-read-band`) and two are correct but wrongly attributed
(`ecr-data-transfer`, `artifact-registry-egress`). All are now forced to
Low-confidence bands with a named warning; totals for those capabilities change
only in confidence, not in amount.

New: `tfMode: as-deployed | what-if` on estimates, and per-line `verification`
provenance. No `modelVersion` bump — meter formulas are unchanged.


Tracks rule / constant updates that bump `modelVersion` in
`packages/cost-engine/src/model-version.ts`.

Frozen estimate exports pin `unitPrices` + `modelVersion`. A **modelVersion**
bump invalidates old pins gracefully (callers must re-estimate). Rate-card age
warnings use 180 days (`PINNED_RATES_WARN_AGE_DAYS`).

## 0.1.3 — 2026-07-29

- TF↔retail reconciliation SSOT (`docs/TF_COST_RECONCILIATION.md` +
  `providers/azure/tf-audit-reconciliation.ts`): Azure audit-only allowlist is
  exactly `eh-standard-tu`, `eh-standard-ingress-events`, `blob-hot-lrs-capacity`.
- Live eastus Retail Prices for those three meters match fallbacks ($0.03 / $0.028 /
  $0.0208) — no silent rate invent; Capture remains forbidden.
- Honesty warnings: Azure comprehensive lists modeled · no connector TF caps;
  AWS/GCP emit a single `no TF inventory — modeled defaults` note (not per-toggle).

## 0.1.2 — 2026-07-29

- `volume.assumedEventBytes` plumbed through `createEstimate` → Azure EH ingress
  events (`gbToMillionEvents`). Rejects `assumedEventBytes <= 0` and `monthHours <= 0`.
- UI assumptions panel exposes `monthHours`, `assumedEventBytes`, `avgStoredGB`,
  `logIntensity`, and `overrideStreamMetrics` (export includes effective volume snapshot).

## 0.1.1 — 2026-07-29

- **Fix (root cause):** AWS `kinesis-put-payload-units` billed as $/unit instead of
  **$/million** PUT payload units (25 KB) — off by 1e6 vs AWS provisioned list price.
  Estimator now charges `putUnits/1e6 × unitPrice`; meter unit is `million-payload-units`.
- Azure `blob-hot-lrs-capacity` fallback refreshed to eastus Hot LRS retail **$0.0208**/GB-mo
  (was $0.018).
- `createEstimate`: stream volume uses accountCount elasticities unless
  `volume.overrideStreamMetrics=true` (presets/paste/manual lock). Response includes
  `resolvedVolume` for UI sync.
- UI: DSPM preflight requires `dataEstateGB > 0`; estimate errors surface API `detail`
  (Azure compare 400 was empty-discovery TF + zero estate).

## 0.1.0 — 2026-07-28

- Initial shared `modelVersion` for multi-cloud Cortex customer-infra estimator.
- Packages 01–12: research maps, rates adapters, hours (730/744/actual), audit
  streams/storage, ADS, DSPM, registry/serverless, egress, volume signals.
- Package 13: rate pinning / freeze export (`core/rate-pinning.ts`) with
  `provider`, `modelVersion`, `ratesAsOf`, `inputHash`, pinned `rateCard`.
- Package 14: official formula regression pack (`providers/formula-regression/`)
  + per-provider golden fixtures; live drift >30% warns (never auto-pass).
- Package 15: OpenAPI 3.1 REST (`info.version` 0.1.0), core `projectCosts`,
  `createEstimate` orchestration, Hono+Zod+Swagger UI, Spectral + openapi-fetch.
- Package 16: rates cache 24h TTL, STALE_DAYS 7/30, refresh-fallback script,
  CI fallback age gate, critical-stale export Ack.

## Dependency pins (package 24 — 2026-07-29)

Workspace deps bumped to latest except documented pins (fail closed, no `--force`):

- **typescript `^5.9.3`** (not 7.x): `openapi-typescript@7` peer requires `typescript@^5.x`.
- **packageManager `pnpm@9.15.0`** (not 11.x): Corepack on this Node 22 toolchain cannot verify
  newer pnpm signing keys (`Cannot find matching keyid`); keep working 9.15.0 until Corepack keys update.
