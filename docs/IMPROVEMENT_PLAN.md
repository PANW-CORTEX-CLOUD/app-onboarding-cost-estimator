# Improvement plan

Working backlog for the cost estimator. Companion to
[`NEXT_STEPS.md`](./NEXT_STEPS.md), which records *what is currently true*;
this file records *what we are going to change and how we will know it worked*.

## How to read this

Every item is written as **Requirement → Use case → Atomic tasks**, and every
atomic task carries its own validation. A task is not done when the code is
written; it is done when its test cases pass, including the edge case, and the
end-to-end path still works.

```
REQ-n            what must become true, in one sentence
  UC-n.m         who needs it and what they do
    T-n.m.k      one atomic, independently verifiable change
      test       unit + edge + e2e that prove it
```

Status vocabulary: `todo`, `doing`, `done`, `blocked`, `needs-approval`.

Markers left in code use `TODO(REQ-n):` so
`grep -rn "TODO" --include="*.ts" --include="*.tsx" --include="*.mjs"` finds
every open thread from the workspace root.

---

# Part A — Correctness

## REQ-1 — No estimate may multiply a quantity by a price in a different unit  `done`

Scanning cost is charged per **operation**, not per gigabyte. The estimator
computes `scannedGB × ratePer10kOps`, which is not a currency amount at all.

Microsoft's own documentation settles the model:

- `Get Blob` is a **Read** operation, and downloading a blob from the Blob
  Service endpoint costs **one read operation per blob** regardless of its size
  ([map-rest-apis-transaction-categories](https://learn.microsoft.com/en-us/azure/storage/blobs/map-rest-apis-transaction-categories),
  [blob-storage-estimate-costs](https://learn.microsoft.com/en-us/azure/storage/blobs/blob-storage-estimate-costs)).
- `List Blobs` bills as **List and create container**, a separate and dearer
  operation type.
- Hot tier data retrieval is **free** — only Cool/Cold/Archive carry a per-GB
  retrieval charge. So there is no per-GB meter to use even if we wanted one.

The same shape holds on the other two clouds: S3 `GET` is Tier2 and `LIST` is
Tier1; GCS `get object` is Class B and `list` is Class A.

### UC-1.1 — An architect sizes DSPM over a 50 TB estate and gets a defensible number

They enter estate size and how much of it is scanned. The estimate must be the
cost of the API calls a scanner really makes, and must state the assumption
that converts bytes into calls.

- **T-1.1.1** `done` Add `avgObjectSizeMB` to DSPM inputs; derive
  `objectsScanned = scannedGB × 1024 / avgObjectSizeMB`.
  *Tests*: exact conversion; **edge** `avgObjectSizeMB <= 0` throws rather than
  dividing by zero; **edge** a zero estate yields zero objects, not `NaN`.
- **T-1.1.2** `done` Price read operations as `objects / 10_000 × readRate`,
  and list operations as `ceil(objects / pageSize) / 10_000 × listRate`, where
  `pageSize` is the provider's documented max keys per list response.
  *Tests*: a worked example reproducing Microsoft's own figures; **edge** fewer
  objects than one page still bills one list operation.
- **T-1.1.3** `done` Add the `blob-hot-lrs-list-10k` meter (verified $0.05/10K,
  `LRS List and Create Container Operations`) with a ledger row.
  *Tests*: ledger↔rate-file binding; crawler re-verifies it live.
- **T-1.1.4** `done` Retire the two invented per-GB meters
  (`s3-data-retrieval-band`, `gcs-data-read-band`) from the DSPM path.
  *Tests*: no estimate emits them; they stay in the ledger as
  `unsupported-meter` so the claim remains recorded and falsifiable.
- **T-1.1.5** `done` Surface `avgObjectSizeMB` in the UI driver step and in the
  OpenAPI contract.
  *Tests*: UI renders it only when DSPM is on; **e2e** covers the DSPM path.

### UC-1.2 — A reviewer asks "why is DSPM this much?" and can follow the arithmetic

- **T-1.2.1** `done` Emit the derived object count and operation counts as
  estimate notes, so the line is auditable without reading the source.
  *Tests*: notes contain object count and both operation counts.

## REQ-2 — Every priced meter must exist in the vendor's price list  `doing`

Four meters do not. Two more are attributed to the wrong service. They are
flagged and forced to Low confidence today, which stops them lying, but they
still produce numbers.

### UC-2.1 — Registry scan on Azure is priced from real ACR SKUs

- **T-2.1.1** `done` — **and the plan above was wrong.** Research corrected it:
  Microsoft states there is *no per-GB charge for pulling images*; the bill is
  the registry SKU plus storage plus standard network egress, and same-region
  pulls incur no egress at all. Billing the daily Registry Unit would have been
  a second error: that SKU is **pre-existing customer infrastructure**, not a
  cost caused by onboarding Cortex, and this repo's own rule is to bill only
  meters Cortex causes.
  What shipped: `acr-pull-bandwidth`, `ecr-data-transfer` and
  `artifact-registry-egress` are all retired, and registry scanning bills
  `azure-egress-gb` / `aws-egress-gb` / `gcp-egress-gb` — real, verified meters
  — only when `crossRegionPull` is true.
  *Tests*: same-region pull is $0; cross-region uses the egress meter; the
  retired ids are billed by nothing; **e2e** confirms $0 same-region via the API.

### UC-2.2 — GCP ADS snapshots are priced from the source disk type

- **T-2.2.1** `todo` Replace the flat `pd-snapshot-storage` constant with a
  `sourceDiskType` input (pd-standard | pd-balanced | pd-ssd), since GCP prices
  standard snapshots as the underlying disk.
  *Tests*: each disk type yields its own rate; **edge** an unknown disk type
  fails closed rather than defaulting to the cheapest.

### UC-2.3 — The GCP scanner VM is a named SKU

- **T-2.3.1** `todo` Name the machine type behind `gce-outpost-scanner`
  (e2-standard-2 is the analogue of Azure D2s v3 and AWS t3.medium) and record
  the quote. Clears the last `unverified` row and its `blockedReason`.
  *Tests*: ledger gate stops reporting a blocked row.

## REQ-3 — Volume tiers and free allowances must not be silently ignored  `done`

Several verified meters are only the **first** tier of a graduated price, and
several services have free grants the estimator never applies. Large estates are
over-estimated and small ones over-estimated again — both wrong, in opposite
directions.

### UC-3.1 — A 200 TB estate is not billed at the first-tier rate throughout

- **T-3.1.1** `done` Ladders modelled for `blob-hot-lrs-capacity` (0/51200/512000),
  `s3-standard-storage` (0/51200/512000), `azure-egress-gb`
  (0/100/10335/51295/153695) and `aws-egress-gb` (0/10240/51200/153600) —
  boundaries read from Azure `tierMinimumUnits` and AWS `beginRange`, not
  transcribed from a marketing page. `gcp-egress-gb` is left flat: Google
  publishes no keyless feed, so its boundaries cannot be verified.
  *Tests*: bands charged at their own rates; **edge** exactly on a boundary
  stays in the lower band; **edge** one unit past opens the next band with one
  unit; **edge** zero, fractional, negative, non-finite; malformed ladders
  rejected; **e2e** 200,000 GB bills $4,036.20 rather than $4,160.00.
- **T-3.1.2** `done` `applyFreeAllowances`, default **off**. Azure publishes its
  100 GB egress allowance as a real $0 band, so honouring the ladder blindly
  would apply it — but the allowance is granted **per subscription and shared
  across every service in it**, so a subscription already using it elsewhere
  would get an understated quote. Off by default re-prices the free band at the
  first paid rate while leaving every published boundary intact.
  *Tests*: default charges from the first unit; opt-in honours the band;
  **edge** opt-in still charges above the boundary; **edge** a ladder with no
  free band, and an entirely-free ladder, are both left alone.

## REQ-10 — A rate's source must not change the answer  `done`

Found while validating REQ-3 end to end: tiering worked from the in-repo rate
file and **vanished whenever a live or cached rate card was used**, because each
adapter rebuilt `unitPrices` by hand and dropped `unitTiers`. Same inputs,
different answer, no warning — the worst shape a defect can take.

The AWS and GCP adapters were worse still: they replaced the document with the
live response rather than layering over it, so any meter the live query missed
simply had no price.

- **T-10.1.1** `done` One `mergeLiveOverFallback` helper for all three adapters.
  A live price that confirms the recorded one keeps its ladder; a live price
  that differs drops to flat **and warns**, because fresh price plus stale
  boundaries would invent a ladder nobody published.
  *Tests*: confirmed price keeps the ladder; uncovered meter keeps price and
  ladder; **edge** re-priced meter goes flat with a warning naming
  `rates:validate`; **edge** a live meter unknown to the document is honoured
  without a ladder; **e2e** the live API path now applies tiers.

*Learning worth keeping*: a feature that reads from a fallback file must be
tested through the live path too, or it only works offline.

## REQ-4 — Rate validation must cover GCP automatically  `todo`

11 GCP meters fall back to a manual 90-day re-read because the Cloud Billing
Catalog API needs a key.

- **T-4.1.1** `todo` Support an optional `GCP_BILLING_API_KEY`; when present,
  crawl the Catalog API like the other two clouds. Absent, keep today's manual
  path — never silently pass.
  *Tests*: with a stub catalog response the crawler verifies a GCP row;
  **edge** an invalid key reports failure and leaves `verifiedAt` untouched.

---

# Part B — Architecture

Findings from a sweep for silent fallbacks, drift, loose validation and
back-compat shims.

## REQ-5 — Defaults must be named, centralised and visible  `done`

`create-estimate.ts` scatters unexplained literals: `730`, `10`, `4`, `24`,
`1`, `0.01`. A reader cannot tell which are conventions, which are guesses, and
which would change a customer's quote.

- **T-5.1.1** `done` Move them into a documented `estimator-defaults.ts` with a
  sentence per constant explaining where the number comes from.
  *Tests*: defaults are re-exported and asserted; totals unchanged.
- **T-5.1.2** `done` The engine now records every default it *substituted* and
  returns them as `appliedDefaults`, each tagged `convention` (730 hours — a
  billing definition, identical for everyone) or `assumption` (10 accounts,
  4 MB objects — a guess about this estate that changes the quote), with a
  rationale.
  The UI renders whatever it is given rather than a hardcoded list, so a new
  engine default appears without anyone editing a widget. `DefaultsTracker`
  throws if a default has no metadata, so an unexplained number cannot reach a
  customer.
  *Tests*: supplied values are not reported; **edge** an explicit zero counts as
  the customer's choice; **edge** a field resolved by several capabilities is
  reported once; **edge** a default with no metadata throws; **edge** the UI
  renders a default it has never heard of; **e2e** the API reports 730 h as a
  convention and 10 accounts as an assumption, and supplying accountCount
  removes it from the list.

## REQ-6 — A missing input must not silently become zero  `done`

`vol.dataEstateGB ?? 0`, `vol.vmCount ?? 0` and friends turn "the user told us
nothing" into "the answer is zero". The estimators then warn, so it is not
silent in the output — but the request layer has already destroyed the
distinction between *absent* and *deliberately zero*.

- **T-6.1.1** `done` Implemented as a declarative guard
  (`providers/capability-drivers.ts`) rather than by changing every estimator's
  signature: a capability whose sizing drivers are *all* absent is refused
  before pricing; an explicit `0` is treated as a decision and priced.
  *Tests*: absent vs zero diverge; **edge** explicit zero is priced and warned;
  **edge** Azure is stricter still (empty discovery TF refuses even an explicit
  zero — two fail-closed rules compose, strictest wins); **edge** as-deployed
  drops an undeployed capability before the guard can reject it; **e2e** the
  API returns a 400 naming the missing fields.

## REQ-7 — The engine must be debuggable without a debugger  `doing` (T-7.1.1 done)

There is no logging anywhere in the engine or API. Diagnosing a wrong total
means adding `console.log` and removing it again.

- **T-7.1.1** `done` Add a dependency-free, level-based, namespaced logger that
  is silent by default and switched on with `DEBUG=cost:*` / `?debug=`.
  *Tests*: silent by default; namespace filtering; **edge** a logger call with a
  throwing serialiser must not break an estimate.
- **T-7.1.2** `todo` Instrument the estimate pipeline: resolved volume, per
  capability meter selection, rate source and verification verdict.

## REQ-9 — One rule, one implementation  `done`

`scripts/validate-prices.mjs` carried its own copy of the ledger↔rate-file
binding rule that also lives in the engine's `assertFallbackMatchesLedger`. The
two drifted the first time the rule changed: retiring a meter satisfied the
engine and still failed the CI gate. The script now imports the engine's
implementation (via `node --experimental-strip-types`), so the rule is defined
once.

*Learning worth keeping*: any invariant asserted in both a gate script and the
engine is a drift waiting to happen. Prefer importing the engine.

## REQ-8 — Public surface should be the surface we mean  `needs-approval`

53 symbols are `export`ed but used only inside their own file, and 5 are
referenced nowhere at all. See the dead-code appendix.

## REQ-9 — Silent fallbacks must not defeat fail-closed guarantees  `doing`

A read-only architecture sweep (silent fallbacks / persistence drift / loose
validation / back-compat cruft) found this codebase unusually disciplined —
most findings below are the exceptions, not a pattern.

### UC-9.1 — A flaky network must not silently unblock a stale-rate export

- **T-9.1.1** `done` `refreshRatesMeta`'s catch cleared `exportFreshness` to
  `null` on any `/rates` fetch failure; `buildEstimateExport`'s `needsAck`
  check treats `null` as "no gate needed," so a transient network error
  silently disabled the fail-closed critical-stale-rates export guarantee.
  Now sets `requiresAckBeforeExport: true` with a banner naming the real
  cause (verification failure, not confirmed staleness).
  *Tests*: `ui-mvp.test.tsx` "a /rates network failure fails closed…".

### UC-9.2 — A negative avgGB must not be treated as "unset"

- **T-9.2.1** `done` `resolveCapacityGb` treated negative `avgGB` the same
  as omitted (applied the floor with a misleading warning) instead of
  throwing, inconsistent with the sibling `writeOps`/`readOps` negative
  checks a few lines below in the same estimators. Now throws.
  *Tests*: `audit-storage.test.ts` "negative avgGB fails closed…".

### UC-9.3 — AWS/GCP "Refresh rates (live)" must either work or say so plainly  `todo`

- **T-9.3.1** `todo` AWS's live-rates path is structurally non-functional
  (the real `index.json` is offers-shaped; the code expects
  products-shaped, so a real fetch always falls through to fallback) and
  GCP's Billing Catalog needs an API key that's never configured anywhere
  in the repo. Every "live" refresh for 2 of 3 clouds silently runs on the
  bundled fallback — not fully silent (a warning string + `ratesSource:
  "fallback"` are emitted), but the labeled capability doesn't exist.
  *Tests*: a live-refresh integration test against a fixture matching the
  **real** `index.json` shape; **edge** GCP with `GCP_BILLING_API_KEY`
  unset states that plainly rather than degrading quietly.

## REQ-10 — User-editable state must be validated as strictly as the API that consumes it  `doing`

### UC-10.1 — A hand-edited share link (`?s=`) must not reach state setters unchecked

- **T-10.1.1** `done` API boundary: `CreateEstimateRequestSchema`'s
  `volume.*` numeric fields (`accountCount`, `dataEstateGB`, `vmCount`, …)
  used bare `z.number().optional()` with no `.nonnegative()`, unlike
  `assumedEventBytes`/`avgObjectSizeMB` which already had `.positive()`.
  Downstream estimators throw on negative values too, but that's
  defense-in-depth, not a substitute for rejecting invalid input at the
  boundary that actually receives it. Matching `minimum: 0` added to
  `openapi.yaml`'s `EstimateVolume` schema.
  *Tests*: `openapi-rest.test.ts` "negative volume fields fail closed…".
- **T-10.1.2** `todo` `deserializeShareState` only validates
  `v`/`provider`/`region`; `capabilities` and `volume` pass through via a
  bare `as ShareState` cast, and `EstimatorPage` then sets numeric state
  directly from those unvalidated fields with no runtime bounds check. The
  API schema (T-10.1.1) is the only remaining backstop — it catches a bad
  value at estimate-submit time, not at share-link-load time.
  *Tests*: a malformed `?s=` with `volume.dataEstateGB=-999` must be
  rejected/sanitized before it reaches `setDataEstateGB`, not just later at
  submit; **edge** a share link with an unexpected `volume` key shape must
  not crash the page.

## REQ-11 — One rule, one implementation  `doing`

A hardcoded-config sweep found the cost-engine's own `core/`/provider
constants already disciplined (named, documented, single-source); the real
duplication was at package **seams** (a value the engine exports getting
re-declared elsewhere) and hand-mirrored copies within the same package.

### UC-11.1 — A fail-closed meter lookup must not require six synchronized edits

- **T-11.1.1** `done` `requireRate()` was defined byte-for-byte identically
  in 6 files (`ads`/`dspm`/`egress`/`streams`/`storage`/
  `registry-serverless` `*.types.ts`). Consolidated into
  `core/rates/require-rate.ts`; each provider file now re-exports it, so
  every existing `import { requireRate } from "./xxx.types.ts"` call site
  kept working unchanged.
  *Tests*: `core/rates/require-rate.test.ts` (new) + all 6 providers'
  existing suites, unchanged, still pass against the re-export.

### UC-11.2 — A currency amount must render the same way everywhere

- **T-11.2.1** `done` `usd()`/`Intl.NumberFormat` was reimplemented in 7
  widgets plus 3 inline calls in `EstimatorPage`, with precision already
  silently diverging (most omitted `maximumFractionDigits`, one file forced
  `0`, another forced `2`). Consolidated into `shared/lib/format-currency.ts`.
  *Tests*: full `apps/web` suite (155 tests) unchanged after the swap.

### UC-11.3 — A documented numeric limit must have one source of truth per layer

- **T-11.3.1** `done` `PROJECTION_MAX_MONTHS=36` was a bare literal in 4
  places (engine, API zod schema, OpenAPI spec, 2 spots in
  `ProjectionCharts.tsx`). `packages/api` now imports the real constant
  from `@cloud-connector/cost-engine` (already a dependency) instead of
  hardcoding `36`. `apps/web` cannot import cost-engine internals directly
  (`web-no-engine-internals-or-api-src` boundary rule), so it gets one
  named, clearly-commented mirror constant replacing its 2 inline literals;
  `openapi.yaml` gets a comment pointing at the source of truth since YAML
  can't import a TS value.
  *Tests*: existing `openapi-rest.test.ts` months>36-rejected case, now
  validated against the imported constant instead of a re-typed literal.

### UC-11.4 — `ORG_STREAM_PRESETS`/`VOLUME_ORG_PRESETS` must not be two hand-synced tables

- **T-11.4.1** `done` `core/volume-signals.ts`'s own comment already said
  "same numbers as stream `ORG_STREAM_PRESETS`" — an acknowledged,
  unenforced duplicate. `providers/streams/audit-stream.types.ts` now
  re-exports `VOLUME_ORG_PRESETS` (and the shared `OrgPresetId` type) from
  `core/` under its existing public name instead of keeping an independent
  copy; the compiler enforces the equality the comment used to assert.
  *Tests*: `providers/streams/__tests__/audit-stream.test.ts`, unchanged,
  still passes against the re-export.

### UC-11.5 — A hand-mirrored warning-prefix list must not silently drift  `todo`

- **T-11.5.1** `todo` `apps/web`'s `tfHonestyConstants.ts` is a
  self-acknowledged manual mirror of cost-engine's
  `tf-audit-reconciliation.ts` warning prefixes ("Mirror of cost-engine
  honesty warning prefixes for UI filtering. Keep in sync with…"), forced
  by the same web/engine boundary rule as T-11.3.1, with no test asserting
  the two actually stay equal today.
  *Tests*: a drift-guard test (same idea as `check-openapi-drift.mjs`) that
  imports both and asserts prefix-for-prefix equality; **edge** adding a new
  warning prefix to one side without the other must fail the test, not
  silently ship.

## REQ-12 — The API must be debuggable without adding console.log  `doing`

### UC-12.1 — A request that fails inside a route handler must leave a trace

- **T-12.1.1** `done` `packages/api` had zero per-request observability —
  only a one-time startup banner and a fatal-config `console.error` before
  `process.exit(1)`. Added `hono/logger` (already a transitive dependency
  of `hono` — no new package) for method/path/status/latency access
  logging on every request. Skipped under `vitest` (`createApp()` is
  called fresh in nearly every API test) so `pnpm test` output stays
  readable.
  *Tests*: manual verification the logger prints on a live request; full
  API suite (20 tests) confirmed silent under vitest.
- **T-12.1.2** `todo` If app-level structured logging is wanted later (not
  just HTTP access logs), adopt `consola` over `pino` — 2.4KB vs 194KB
  gzip, genuine isomorphic Node+browser support matching this repo's
  cost-engine-runs-in-both-places design (`pino/browser` is Node-centric
  and its transport model doesn't work cleanly in edge/bundled contexts).
  Do **not** add the `debug` package specifically — it was one of ~20
  packages in a September 2025 npm supply-chain compromise (phishing an
  npm maintainer account; a malicious version briefly shipped a
  crypto-wallet-hijacking payload) affecting that exact cluster of small,
  high-fanout terminal-utility packages. Not urgent today: current
  footprint is 3 clean, appropriate `console.*` calls total.

---

## Sweep record

A standing sweep for silent fallbacks, drift, loose validation and back-compat
shims. Recorded so a later reader can tell "checked and clean" from "never
looked".

| Date | Pattern | Result |
| --- | --- | --- |
| 2026-08-10 | Duplicated invariants (same rule in a gate script and the engine) | **Found and fixed** — the ledger binding rule existed twice and had already drifted (REQ-9). Now imported. |
| 2026-08-10 | Silent degradation by data source | **Found and fixed** — tiering vanished on live/cached rates (REQ-10). |
| 2026-08-10 | Absent coerced to zero | **Found and fixed** (REQ-6). |
| 2026-08-10 | Swallowed errors (`catch {}`) | Checked all 7. All legitimate: each converts a parse failure into an explicit typed error or Problem response. No change. |
| 2026-08-10 | `as any` / unchecked casts | None in engine, API or web. |
| 2026-08-10 | Remaining `?? 0` | Only where a guard has already rejected the absent case (documented at the site), or where 0 is the correct reading of an absent protobuf field in the GCP catalog parser. |
| 2026-08-10 | Unexplained magic numbers | Moved to `estimator-defaults.ts` with provenance per constant (REQ-5). |

# Part C — Ideation

Deliberately separated from the backlog above: these are directions, not
commitments. Each notes what would have to be true to make it worth doing.

## Short term (weeks) — sharpen what exists

| Idea | Why | Worth it when |
| --- | --- | --- |
| Estimate diffing | "What changed since last quote, and which meter caused it?" is the first question every reviewer asks. Freeze exports already pin everything needed to diff two runs. | Anyone re-quotes an account more than once. |
| Confidence-weighted totals | A total that mixes a verified Event Hubs line with an invented ACR line reads as one number. Weighting, or splitting the total into *vendor-backed* and *modelled*, keeps the honesty visible in the headline. | Modelled capabilities stay in the product. |
| Per-line "show the arithmetic" | The notes now carry object and operation counts; rendering them under each line removes the last reason to read the source. | REQ-1 ships. |
| Ledger freshness badge in the UI | The engine knows each rate's age; the UI still shows one global banner. | Cheap once verification reaches the response, which it now does. |

## Mid term (months) — close the loop with reality

| Idea | Why | Worth it when |
| --- | --- | --- |
| Bill-back calibration | The repo already ingests billing CSVs. Comparing a past estimate against the actual invoice for the same period turns every quote into a data point that tunes the model. | A handful of customers share invoices. |
| Automated ledger PRs | The crawler can already detect drift; having it open a PR when a vendor changes a price makes correctness a background process rather than a chore. | Write access and CI scheduling exist. |
| Terraform plan ingestion | Today the manifest is derived from the connector TF in this repo. Reading a customer's actual `terraform plan -json` would ground the estimate in *their* deployment, not the template. | Customers will share a plan file. |
| Multi-region estates | Everything is single-region. Real estates span regions with different rates and inter-region transfer between them. | Someone asks for a number we currently cannot give. |

## Long term (quarters) — change what the tool is

| Idea | Why | Worth it when |
| --- | --- | --- |
| Continuous estimate vs actual | An estimator that keeps watching after onboarding becomes a cost-anomaly detector: the model predicts, the bill arrives, the delta is the signal. | Calibration data exists and is trusted. |
| Provider-agnostic meter algebra | Each provider estimator re-implements the same shape (quantity → unit → rate → line). A small algebra of dimensioned quantities would make REQ-1-class bugs unrepresentable rather than merely tested for. | A fourth provider, or a second REQ-1-class bug. |
| Optimisation advice | Once tiers and allowances are modelled the tool can say *reserve capacity above 82 TB*, *pull in-region*, *batch scans* — advice rather than arithmetic. | REQ-3 ships. |

---

# Appendix — dead code

`needs-approval`: three symbols predate this work and are referenced nowhere,
including inside their own files. They look like unfinished or superseded
features rather than mistakes, so they need a decision rather than a delete.

| Symbol | File | What it looks like |
| --- | --- | --- |
| `kinesisPutPayloadMillions` | `providers/aws/aws-stream-estimator.ts` | A helper converting PUT payload units to millions. The estimator does the same conversion inline. Either the helper was superseded, or the inline maths should call it. **Recommend: use it inline and keep one implementation.** |
| `AzureTfAuditBillableMeter` | `providers/azure/tf-audit-reconciliation.ts` | A union type derived from the billable-meter array, never used in an annotation. Harmless, and useful if anything ever needs to type a meter id. **Recommend: keep, it costs nothing and documents intent.** |
| `StorageRedundancy` | `providers/storage/audit-storage.types.ts` | A redundancy union (LRS/GRS/ZRS). Each provider instead keeps its own `*_ALLOWED_REDUNDANCY` array. Looks like an abandoned shared abstraction. **Recommend: either adopt it in all three providers or delete it — the current split is the worst of both.** |

Two symbols added in the previous change were unused and have been removed
rather than left for approval, since they were mine and never shipped:
`UNTRUSTED_VERDICTS`, `deployedMetersFor`.

The 53 over-exported symbols are not dead — they are used inside their defining
file but exposed anyway. They widen the package's public surface and make
refactoring harder than it needs to be. Tracked as REQ-8; not urgent.

## New findings this session — `needs-approval`, awaiting a human decision

Found via a dead-code/unfinished-feature audit (export-usage cross-reference
across all three packages + `apps/web`, plus a TODO/FIXME grep that returned
zero hits — this repo doesn't leave inline deferred-work comments). None of
these have been deleted or finished; they're listed here for approval per
this repo's standing rule that dead code gets a human decision, not a
unilateral delete.

| Symbol / area | File | What it looks like | Recommendation |
| --- | --- | --- | --- |
| `freezeEstimate` / `loadFrozenEstimate` / `rateCardFromFreeze` / `validateExportSchema` (the rate-pinning "freeze export" module) | `core/rate-pinning.ts` | A complete, well-tested pin/freeze/reload-and-verify cycle, documented in `docs/CLOUD_COST_MODEL.md` as a real use case ("Reproducible export … Frozen rates + modelVersion"). No HTTP route exposes it (`openapi.yaml` has no `/estimates/freeze` or `/reload` path) and `apps/web` never imports cost-engine directly, so the capability is unreachable from any caller today. Only `createInputHash`/`estimateExportFields` (2 of ~8 symbols) are actually consumed, by `create-estimate.ts`. | **FINISH** (add `POST /v1/estimates/freeze` + `/reload` routes and wire the existing "Freeze rates snapshot" UI button to them) **or DELETE** the unreachable half, keeping only the 2 symbols in real use. Genuinely looks like an intentionally-started feature, not an accident — needs a product decision on whether "freeze and reproduce a quote later" ships. |
| `HowToUseEstimator` | `widgets/HowToUseEstimator/HowToUseEstimator.tsx` | Zero references anywhere outside its own file. `JourneyIntro.tsx`'s own comment says it "replaces long scroll how-to" and reuses the same `data-testid="how-to-use-honesty"` for its closing paragraph — direct evidence it superseded this component during a UX rework, and the old file was never deleted. Its CSS (`.how-to-use__steps`) is dead too. | **DELETE.** High confidence — superseded, zero references, corroborating comment in the replacement component. |
| `loadLastShareState` (+ `readLocalJson`) | `shared/lib/safe-storage.ts` | The read-back half of a write/read pair: `saveLastShareState` **is** called (`EstimatorPage.tsx` `onCopyShareLink`, as a local backup whenever a share link is copied), but nothing ever calls `loadLastShareState` to restore it — e.g. as a fallback when the `?s=` URL param is missing or truncated. Looks like a safety-net feature that shipped half-wired: write path done, read/restore path never connected. | **FINISH** (call it during bootstrap when no `?s=` param is present) **or DELETE** (drop the read half and `readLocalJson` if the recovery UX isn't wanted) — a small, cheap decision either way. |
| `AWS_TF_PRESENT` / `GCP_TF_PRESENT` | `providers/{aws,gcp}/capability-meter-map.ts` | Both hardcoded `false`, re-exported publicly, referenced only by their own declaration, the package re-export, and a test that asserts `toBe(false)`. No conditional anywhere reads either flag — `tf-honesty-warnings.ts` reimplements the same "AWS/GCP have no TF inventory" fact via a hardcoded provider-name check instead of consulting these flags. Inert today because both providers' Terraform readiness genuinely is "not yet" (see `docs/CLOUD_COST_MODEL.md`'s provider-readiness table — this is intentional placeholder state, not a mistake), but the flags currently do nothing. | **UNCLEAR** — either wire `tf-honesty-warnings.ts` to branch on the flag (so it becomes meaningful the day AWS/GCP Terraform lands) or remove the flags and keep the hardcoded check. Lower priority than the other three rows. |
| `capabilityForAffectsField` | `shared/model/tf-grounding.ts` | Zero references anywhere, including within its own file. `shared/lib/affects-chips.ts` (a later addition per its own package-number comment) independently reimplements the same "which volume field maps to which capability/meters" concept with its own field list. The constant it reads (`AUDIT_AFFECTS_FIELD_IDS`) is still used elsewhere — only the function itself is dead. | **DELETE.** High confidence — superseded by `affects-chips.ts`, zero references, the one thing it reads is used elsewhere so nothing else breaks. |
