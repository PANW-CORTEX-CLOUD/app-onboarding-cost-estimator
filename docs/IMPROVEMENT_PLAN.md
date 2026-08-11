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

**Claiming an ID.** More than one session edits this file, and REQ-9 and REQ-10
were each independently used for two different requirements before anyone
noticed — which also produced two requirements sharing the title "One rule, one
implementation". Before adding a requirement, take the next number **above the
highest that appears anywhere in this file**, including sections you did not
write, and grep the repo for `REQ-<n>` to be certain nothing already refers to
it. Code markers are `TODO(REQ-n)`, so a reused number silently mislabels a
piece of code.

Markers left in code use `TODO(REQ-n):` so
`grep -rn "TODO" --include="*.ts" --include="*.tsx" --include="*.mjs"` finds
every open thread from the workspace root.

## Index

Sections are grouped by theme rather than by number, so this is the fastest way
to find one.

| ID | Requirement | Status |
| --- | --- | --- |
| [REQ-1](#req-1--no-estimate-may-multiply-a-quantity-by-a-price-in-a-different-unit) | No estimate may multiply a quantity by a price in a different unit | `done` |
| [REQ-2](#req-2--every-priced-meter-must-exist-in-the-vendor-s-price-list) | Every priced meter must exist in the vendor's price list | `done` |
| [REQ-3](#req-3--volume-tiers-and-free-allowances-must-not-be-silently-ignored) | Volume tiers and free allowances must not be silently ignored | `done` |
| [REQ-4](#req-4--rate-validation-must-cover-gcp) | Rate validation must cover GCP | `done` |
| [REQ-5](#req-5--defaults-must-be-named-centralised-and-visible) | Defaults must be named, centralised and visible | `done` |
| [REQ-6](#req-6--a-missing-input-must-not-silently-become-zero) | A missing input must not silently become zero | `done` |
| [REQ-7](#req-7--the-engine-must-be-debuggable-without-a-debugger) | The engine must be debuggable without a debugger | `done` |
| [REQ-8](#req-8--public-surface-should-be-the-surface-we-mean) | Public surface should be the surface we mean | `done` |
| [REQ-9](#req-9--one-rule-one-implementation) | One rule, one implementation | `done` |
| [REQ-10](#req-10--silent-fallbacks-must-not-defeat-fail-closed-guarantees) | Silent fallbacks must not defeat fail-closed guarantees | `done` |
| [REQ-11](#req-11--user-editable-state-must-be-validated-as-strictly-as-the-api-that-consumes-it) | User-editable state must be validated as strictly as the API that consumes it | `done` |
| [REQ-12](#req-12--a-rate-s-source-must-not-change-the-answer) | A rate's source must not change the answer | `done` |
| [REQ-13](#req-13--the-api-must-be-debuggable-without-adding-console-log) | The API must be debuggable without adding console.log | `done` |
| [REQ-14](#req-14--a-test-must-not-be-able-to-silently-not-run) | A test must not be able to silently not-run | `done` |
| [REQ-15](#req-15--the-api-must-be-testable-without-the-network) | The API must be testable without the network | `done` |
| [REQ-16](#req-16--error-responses-must-carry-the-media-type-the-contract-declares) | Error responses must carry the media type the contract declares | `done` |
| [REQ-17](#req-17--an-unexpected-error-must-not-leak-its-raw-message-to-the-client) | An unexpected error must not leak its raw message to the client | `done` |
| [REQ-18](#req-18--a-persisted-blob-must-not-be-trusted-just-because-it-parses) | A persisted blob must not be trusted just because it parses | `done` |

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

## REQ-2 — Every priced meter must exist in the vendor's price list  `done`

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

### UC-2.2 — GCP ADS snapshots are priced honestly  `done`

- **T-2.2.1** `done` — **and the plan above was wrong, again.** The task as
  written was to add a `sourceDiskType` input because "GCP prices standard
  snapshots as the underlying disk." Research **refuted the premise**, so the
  `sourceDiskType` input was **not built** — building it would have encoded a
  false model and dressed it as rigour (the exact T-2.1.1 mistake).

  Verified 2026-08-11 against
  [docs.cloud.google.com/compute/docs/disks/snapshots](https://docs.cloud.google.com/compute/docs/disks/snapshots):
  snapshot storage "charge[s] only for the total size of the snapshot" — a
  **single flat $/GB-month rate**, the same for every source disk type, on the
  compressed *incremental* used size. So one flat meter is the correct shape;
  the plan's per-disk-type refinement was the wrong fix and is dropped.

  What shipped instead is a real **bug fix found by the research**: the fallback
  value `pd-snapshot-storage = 0.026` was the **pre-2023 regional price**. GCP
  raised us-central1 regional standard-snapshot storage to **0.05/GB-month** on
  2023-04-01, so the estimator was under-charging snapshots ~2×. Corrected the
  fallback to 0.05 and the ledger to match.

  Confidence handling: the row moves from `unsupported-meter` (which was itself
  wrong — it *is* a real vendor meter) to `unverified`, because the exact value
  comes from the documented 2023 price change plus corroborating secondary
  sources, **not** a machine-readable official feed — Google's pricing page is
  client-rendered and its Cloud Billing Catalog needs an API key. `unverified`
  keeps every ADS line at Low confidence with a named warning, so 0.05 is never
  presented as vendor-backed; it is simply the current figure instead of a
  three-year-stale one.
  *Tests*: `ads.test.ts`, `formula-regression.test.ts`,
  `price-validation.test.ts`, `meter-closure.test.ts` all green (52); ledger
  binding + fallback-age gates pass; the ADS line still carries `trusted:false`
  / Low confidence / a `pd-snapshot-storage` warning.
  *Learning*: two of this plan's three "priced as underlying X" GCP premises
  (this and `gcs-data-read-band`) turned out false on contact with the vendor
  docs. A plan note that a price "varies by underlying resource type" is a
  hypothesis to verify, not a spec to implement.

### UC-2.3 — The GCP scanner VM is a named SKU  `done`

(Two copies of this task existed after a cross-session merge — the numbering
collision the header warns about. Consolidated here.)

- **T-2.3.1** `done` Named the scanner machine type **e2-standard-2**
  (2 vCPU / 8 GiB) — the GCP analogue of Azure D2s v3 (2 vCPU / 8 GB); AWS
  t3.medium is smaller (2 vCPU / 4 GB), so the choice is stated rather than
  assumed, and it matches the size the other two clouds already price.
  Corrected the value from $0.0475/hour to the **on-demand** us-central1 list
  rate **$0.067/hour**: the old number was neither on-demand ($0.067) nor spot
  ($0.0402) but the sustained-use-discounted rate, which is wrong for an
  ephemeral VM billed `rate × scansPerMonth × hoursPerScan` — a couple of hours
  per scan is far below the sustained-use threshold. Recorded `machineType` in
  the ledger row and named the SKU in a code comment on
  `GCP_ADS_OUTPOST_METER`.
  The row stays `unverified` (Low confidence + warning on every ADS Outpost
  line) because $0.067 is corroborated by two secondary sources
  (gcloud-compute.com, instances.vantage.sh) but not a machine-readable
  official feed — GCP's pricing page is client-rendered. The "no machine type"
  blocker is cleared; only the crawl limitation remains (REQ-4).
  *Tests*: ledger binding + fallback-age gates pass at 0.067; the three ADS/DSPM
  fixtures using the old synthetic 0.0475 were updated to 0.067 (their
  assertions test `computeCost > 0` / `=== 0`, not the literal rate).
  *Learning*: for an ephemeral resource, the honest rate is **on-demand**, not
  the sustained-use or committed-use figure a pricing page may headline — the
  discount encodes a usage commitment the workload does not make.

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

## REQ-12 — A rate's source must not change the answer  `done`

Found while validating REQ-3 end to end: tiering worked from the in-repo rate
file and **vanished whenever a live or cached rate card was used**, because each
adapter rebuilt `unitPrices` by hand and dropped `unitTiers`. Same inputs,
different answer, no warning — the worst shape a defect can take.

The AWS and GCP adapters were worse still: they replaced the document with the
live response rather than layering over it, so any meter the live query missed
simply had no price.

- **T-13.1.1** `done` One `mergeLiveOverFallback` helper for all three adapters.
  A live price that confirms the recorded one keeps its ladder; a live price
  that differs drops to flat **and warns**, because fresh price plus stale
  boundaries would invent a ladder nobody published.
  *Tests*: confirmed price keeps the ladder; uncovered meter keeps price and
  ladder; **edge** re-priced meter goes flat with a warning naming
  `rates:validate`; **edge** a live meter unknown to the document is honoured
  without a ladder; **e2e** the live API path now applies tiers.

*Learning worth keeping*: a feature that reads from a fallback file must be
tested through the live path too, or it only works offline.

## REQ-4 — Rate validation must cover GCP  `done`

The original title said "…automatically", meaning a machine crawl like the Azure
Retail and AWS Price List APIs give. Research settled that this is **not possible
keylessly** for GCP, and that the automation was never the real requirement —
*coverage* was:

- The old keyless price feed (`cloudpricingcalculator.appspot.com/static/data/pricelist.json`)
  is **decommissioned** (returns 404).
- The Cloud Billing Catalog API requires an API key, which cannot be committed
  to the repo (a secret) and which this project has no way to inject.
- The public pricing pages render their tables client-side, so there is no
  server-rendered figure to scrape.

There is therefore no keyless machine-readable authoritative GCP feed. But the
authoritative source does not have to be an API — it is the **official Google
documentation itself**, and the ledger already models exactly this with
`method: "official-doc"` (90-day re-read cadence). So the real fix was not a key
but recognising documentation-verification as first-class.

- **T-4.1.1** `done` (adapter) The GCP rates adapter accepts `apiKey` /
  `GCP_BILLING_API_KEY`; without one it serves the crawler-verified file and
  says why, instead of issuing a request the Catalog API refuses outright. The
  key path stays supported for anyone who *does* have one — it just is not
  required for coverage.
- **T-4.1.2** `done` The last two GCP meters that were still `unverified`
  pending a machine probe (`pd-snapshot-storage`, `gce-outpost-scanner`) are now
  `verified` via `method: "official-doc"`. Each value was reconfirmed against
  the official Google pricing doc plus multiple independent price references
  ($0.05/GB-month regional standard-snapshot storage per GCP's 2023-04-01 price
  change; $0.067/hour e2-standard-2 on-demand us-central1). Result: **every
  billable meter on all three clouds is vendor-backed** — the untrusted rows
  that remain are all retired `unsupported-meter`/`proxy` records that no
  estimate bills.
  *Tests*: `price-validation.test.ts` — a GCP meter with no machine feed is
  verified against official documentation (not left blocked); GCP ADS is
  vendor-backed and keeps its declared Med confidence (not forced Low); **the
  "every meter is vendor-verified" milestone test now covers gcp** alongside
  azure and aws. The offline price-validation gate passes with `verified=29`.
  *Learning*: "automatically" was a proxy for "kept honest on a schedule". A
  90-day human re-read of the official doc is real coverage; insisting on a
  machine crawl that no keyless feed supports would have left the meter
  perpetually `unverified` for a purity that adds no correctness.

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

### REQ-6.2 — Every multiplicand driver is required, not just one  `done`

*Requirement.* When a capability's cost is a **product** of several sizing
drivers, supplying only one of them must not silently zero the estimate.

*Use case.* An operator enables **ADS Cloud**, types the average used disk
(`avgUsedDiskGB = 100`), and forgets the VM count. ADS prices
`snapshotCost = vmCount × scansPerMonth × prorate(avgUsedDiskGB)`, so the
missing `vmCount ?? 0` collapses the whole snapshot line to **$0** — a real
quote-looking zero for a capability the operator explicitly turned on. This was
possible because T-6.1.1's guard accepted "at least one" driver; both ADS
drivers are multiplicands with no documented default, so "at least one" is too
weak. *(Found by probing the guard against reality, not from the spec.)*

*Fix.* `CAPABILITY_SIZING_DRIVERS` now means **all listed drivers are required**
(explicit `0` still counts as a decision). Fields that carry a documented
default (`scansPerMonth`, `pctScanned`, `avgObjectSizeMB`, …) were never listed
as drivers, so no legitimate partial input is newly rejected. `registry` lists
`imageCount` only: its second field `avgImageGB` feeds the cross-region pull
path, and `crossRegionPull` is hard-wired `false`, so requiring it would force a
field that changes no total (TODO at the call site in `create-estimate.ts`).

*Test cases.* unit: ADS with one driver reports the **specific** missing field;
both present → sized; **edge** an explicit `0` on one driver does not excuse an
absent other; **edge** registry requires `imageCount`, not `avgImageGB`.
integration: ADS size-only rejects naming `VM count`; ADS with both prices a
non-zero snapshot line. **e2e**: `POST /v1/estimates` with `adsCloud` + only
`avgUsedDiskGB` returns 400 with detail `ads_cloud (needs: VM count)`.

*Layer note.* The rule lives in the engine, not the Zod schema:
[`z.optional()` cannot distinguish absent from `undefined`](https://github.com/colinhacks/zod/issues/1628),
and a Zod `.superRefine()` would duplicate the capability→driver map into a
second source of truth — the exact drift this repo keeps deleting. The engine
owns the map; the API surfaces its throw as a 400.

*Follow-on found.* The provider-compare request in `EstimatorPage.tsx` omitted
`vmCount`/`avgUsedDiskGB`, so comparing providers with ADS on errored every
column. Fixed for parity with the main-run and tier-compare paths.

## REQ-7 — The engine must be debuggable without a debugger  `done`

There is no logging anywhere in the engine or API. Diagnosing a wrong total
means adding `console.log` and removing it again.

- **T-7.1.1** `done` Add a dependency-free, level-based, namespaced logger that
  is silent by default and switched on with `DEBUG=cost:*` / `?debug=`.
  *Tests*: silent by default; namespace filtering; **edge** a logger call with a
  throwing serialiser must not break an estimate.
- **T-7.1.2** `done` Instrumented the estimate pipeline under the
  `cost:estimate` namespace: the Terraform gate's requested→effective→excluded
  capability sets, the rate card's source/capturedAt/ageDays and **which meters
  carry a tier ladder**, the resolved stream volume next to the `accountCount`
  and override flag that produced it, one line per priced meter with amount,
  confidence and verification verdict, and an `info`-level total.
  Those are the four things that decide a total and none of them are visible
  in the response, so "why is this number what it is?" previously meant adding
  `console.log`. Every message is a thunk, so it costs nothing when off.
  *Tests*: verified silent with `DEBUG` unset; verified the full trace renders
  under `DEBUG=cost:*` against a real Azure audit+DSPM estimate, and that the
  traced total equals the returned total.

## REQ-8 — Public surface should be the surface we mean  `done`

The starting observation was "53 symbols are exported but used only inside their
own file". Investigating it showed that is not one problem but three, and only
one is a defect:

| Category | Count | Action |
| --- | --- | --- |
| Types appearing in exported signatures | 29 | **Keep.** Public by construction — a consumer cannot name `priceQuantity`'s return type otherwise. |
| Domain constants that are the package's vocabulary | ~19 | **Export the siblings.** `AZURE_EH_MBPS_PER_TU` was public while `AZURE_EH_MIN_TU` was not; the surface was *incoherent*, not too large. |
| Genuine internals (adapter query URLs, a cache entry shape) | 5 | **Unexport.** |

So the fix was mostly the opposite of the premise: a smaller surface would have
hidden half of a documented formula binding. `src/__tests__/public-surface.test.ts`
now asserts each binding set is reachable *as a complete set*, and that adapter
query URLs stay internal.

*Learning worth keeping*: "unused export" is not automatically clutter. Ask what
role it plays — signature, vocabulary, or implementation detail — before
deleting it.

## REQ-10 — Silent fallbacks must not defeat fail-closed guarantees  `done`

A read-only architecture sweep (silent fallbacks / persistence drift / loose
validation / back-compat cruft) found this codebase unusually disciplined —
most findings below are the exceptions, not a pattern.

### UC-10.1 — A flaky network must not silently unblock a stale-rate export

- **T-10.1.1** `done` `refreshRatesMeta`'s catch cleared `exportFreshness` to
  `null` on any `/rates` fetch failure; `buildEstimateExport`'s `needsAck`
  check treats `null` as "no gate needed," so a transient network error
  silently disabled the fail-closed critical-stale-rates export guarantee.
  Now sets `requiresAckBeforeExport: true` with a banner naming the real
  cause (verification failure, not confirmed staleness).
  *Tests*: `ui-mvp.test.tsx` "a /rates network failure fails closed…".

### UC-10.2 — A negative avgGB must not be treated as "unset"

- **T-10.2.1** `done` `resolveCapacityGb` treated negative `avgGB` the same
  as omitted (applied the floor with a misleading warning) instead of
  throwing, inconsistent with the sibling `writeOps`/`readOps` negative
  checks a few lines below in the same estimators. Now throws.
  *Tests*: `audit-storage.test.ts` "negative avgGB fails closed…".

### UC-10.3 — AWS/GCP "Refresh rates (live)" must either work or say so plainly  `done`

- **T-10.3.1** `done` AWS's live-rates path is structurally non-functional
  (the real `index.json` is offers-shaped; the code expects
  products-shaped, so a real fetch always falls through to fallback) and
  GCP's Billing Catalog needs an API key that's never configured anywhere
  in the repo. Every "live" refresh for 2 of 3 clouds silently runs on the
  bundled fallback — not fully silent (a warning string + `ratesSource:
  "fallback"` are emitted), but the labeled capability doesn't exist.
- **T-10.3.2** `done` Both plain-statement paths are now under test, closing
  the UC's own test obligation (the behaviour existed but the GCP edge was
  unverified, which is why the UC stayed open). `rates-module.test.ts`:
  "AWS says plainly that it has no per-request live feed" (existing), and
  **edge** "with `GCP_BILLING_API_KEY` unset, says plainly how to enable live
  rates" (new — `vi.stubEnv` forces the key-unset path deterministically, then
  asserts `ratesSource: "fallback"` + a warning naming both `GCP_BILLING_API_KEY`
  and `rates:validate`, with a still-complete fallback card). What remains for GCP
  is the *live crawl itself*, tracked separately as REQ-4 (needs the key).

## REQ-11 — User-editable state must be validated as strictly as the API that consumes it  `done`

### UC-11.1 — A hand-edited share link (`?s=`) must not reach state setters unchecked

- **T-11.1.1** `done` API boundary: `CreateEstimateRequestSchema`'s
  `volume.*` numeric fields (`accountCount`, `dataEstateGB`, `vmCount`, …)
  used bare `z.number().optional()` with no `.nonnegative()`, unlike
  `assumedEventBytes`/`avgObjectSizeMB` which already had `.positive()`.
  Downstream estimators throw on negative values too, but that's
  defense-in-depth, not a substitute for rejecting invalid input at the
  boundary that actually receives it. Matching `minimum: 0` added to
  `openapi.yaml`'s `EstimateVolume` schema.
  *Tests*: `openapi-rest.test.ts` "negative volume fields fail closed…".
- **T-11.1.2** `done` `deserializeShareState` only validated
  `v`/`provider`/`region`; `capabilities` and `volume` pass through via a
  bare `as ShareState` cast, and `EstimatorPage` then sets numeric state
  directly from those unvalidated fields with no runtime bounds check. The
  API schema (T-10.1.1) is the only remaining backstop — it catches a bad
  value at estimate-submit time, not at share-link-load time.
  *Tests*: a malformed `?s=` with `volume.dataEstateGB=-999` must be
  rejected/sanitized before it reaches `setDataEstateGB`, not just later at
  submit; **edge** a share link with an unexpected `volume` key shape must
  not crash the page.

## REQ-9 — One rule, one implementation  `done`

Two sessions found this independently, from opposite ends. Merged here so it
reads as one requirement with several instances. Every identified duplicate
now has a single implementation; a newly-found instance gets a fresh task.

### UC-9.0 — A CI gate must not re-implement an engine invariant

- **T-9.0.1** `done` `scripts/validate-prices.mjs` carried its own copy of the
  ledger↔rate-file binding rule that also lives in the engine's
  `assertFallbackMatchesLedger`. The two drifted the first time the rule
  changed: retiring a meter satisfied the engine and still failed the gate. The
  script imports the engine's implementation now (via
  `node --experimental-strip-types`).
  *Learning*: any invariant asserted in both a gate script and the engine is a
  drift waiting to happen. Import the engine.

### UC-9.1 — "Does this provider have Terraform inventory?" must have one answer

- **T-9.1.1** `done` `tf-honesty-warnings.ts` decided whether to push the
  "no TF inventory" note with a hardcoded provider-name check, while
  `AWS_TF_PRESENT`/`GCP_TF_PRESENT` (both `false`) sat inert in each provider's
  `capability-meter-map.ts` saying the same thing. Two encodings of one fact —
  the day AWS/GCP Terraform lands, someone flips a flag and the warning keeps
  firing from the stale hardcoded check. Now the warning branches on the flags
  (`provider === "aws" ? AWS_TF_PRESENT : GCP_TF_PRESENT`), so the flags are the
  single source of truth and the note becomes correct automatically.
  *Tests*: `tf-honesty-warnings.test.ts` stubs `AWS_TF_PRESENT: true` and asserts
  the note is *not* pushed; the flags' `toBe(false)` invariant stays in
  `capability-meter-map.test.ts`.


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

### UC-11.5 — A hand-mirrored warning-prefix list must not silently drift  `done`

- **T-11.5.1** `done` `scripts/check-tf-honesty-drift.mjs` imports **both**
  `apps/web`'s `tfHonestyConstants.ts` and the engine's
  `tf-audit-reconciliation.ts` as real modules (via
  `--experimental-strip-types`) and compares the values the programs actually
  use, rather than scraping either as text. Runs inside `pnpm test`.
  The mirror is forced by the web/engine boundary rule (T-11.3.1) and cannot
  be collapsed; what it no longer is, is unchecked. The failure it prevents is
  silent by construction: the UI matches these strings to decide whether to
  render the honesty banner, so a reworded prefix would not throw — the
  disclosure would just stop appearing, with every test still green.
  Strings compare exactly; the meter allowlist compares as a **set**, so a
  harmless reorder is not a false alarm but an added/removed meter is.
  *Tests*: verified by mutation, not assumption — reworded the prefix on one
  side (caught, exit 1), removed a meter from one side (caught, exit 1),
  in-sync (exit 0). Exit codes checked directly, since a gate that prints an
  error but exits 0 would pass CI while appearing to work.

  *Learning*: `edge-plus-hardening.test.ts` bans the literal string
  `packages/cost-engine/src/providers/` anywhere under `apps/web/src` to stop
  deep imports — and it matches **file text, not imports**, so even naming the
  path in a doc comment trips it. Refer to engine files by basename from web
  code.

## REQ-13 — The API must be debuggable without adding console.log  `done`

### UC-13.1 — A request that fails inside a route handler must leave a trace

- **T-13.1.1** `done` `packages/api` had zero per-request observability —
  only a one-time startup banner and a fatal-config `console.error` before
  `process.exit(1)`. Added `hono/logger` (already a transitive dependency
  of `hono` — no new package) for method/path/status/latency access
  logging on every request. Skipped under `vitest` (`createApp()` is
  called fresh in nearly every API test) so `pnpm test` output stays
  readable.
  *Tests*: manual verification the logger prints on a live request; full
  API suite (20 tests) confirmed silent under vitest.
- **T-13.1.2** `done` App-level structured logging, **without adding a
  package**. The recommendation here was `consola`; the better answer was that
  the cost-engine already has a dependency-free namespaced logger
  (`core/debug-log.ts`), so the API uses that. One switch now lights up both
  layers and the engine's own lines interleave with the request that caused
  them:

  ```
  DEBUG=cost:*   pnpm --filter @cloud-connector/api start
  ```

  The two loggers have distinct jobs and that is now stated in the code:
  `hono/logger` is the always-on **access** log (what traffic was served);
  `request-log.ts` is the opt-in **diagnostic** log (why a request produced that
  number) — correlation id, rate source, TF mode, confidence, meter count,
  applied-defaults count, and the reason behind every rejection.

  The supply-chain caution recorded here was verified rather than repeated: on
  8 September 2025 a maintainer was phished via `npmjs.help` and malicious
  versions of ~18 packages including `debug` and `chalk` shipped for roughly two
  hours carrying a crypto-wallet-hijacking payload. Those packages are fine
  today; the durable lesson is that a dependency added for something we already
  have is a standing exposure bought for nothing.
  *Tests*: silent when the namespace is off; a caller-supplied `x-request-id` is
  echoed and a missing one minted; **edge** a blank header is replaced not
  echoed; estimate outcome carries provider/tfMode/rates/confidence/meters;
  **edge** both schema and engine rejections log their reason. **e2e** verified
  against a running API with `DEBUG=cost:*`.

## REQ-14 — A test must not be able to silently not-run  `done`

The worst failure a test can have is not to run: `pnpm test` stays green while
none of its assertions execute, which looks exactly like success.

### UC-14.1 — A test file added to a shared directory is actually executed

`vitest.config.ts` globs each per-provider directory, but the two cross-cutting
test directories (`src/providers/__tests__/`, `src/__tests__/`) were enumerated
**file by file**. A new test dropped into either that no `include` matched ran
nowhere and reported nothing. A pre-existing `TODO(test-discovery)` flagged the
trap; all files happened to be listed, so it was latent, not yet firing.

- **T-14.1.1** `done` Replaced both hand-lists with directory globs
  (`src/providers/__tests__/**/*.test.ts` under a new `providers-shared`
  project; `src/__tests__/**/*.test.ts` under `monorepo`). Coverage-neutral:
  38→39 files and 354→357 tests, the delta being the guard below — no existing
  test dropped or double-ran.
  *Tests*: `src/__tests__/test-discovery.test.ts` (new) asserts every physical
  `*.test.ts` under the two shared dirs is matched by a config `include` glob,
  and that none is listed by literal name. **Verified by mutation**: reverting
  a glob to a single-file listing makes the guard fail with the exact files
  that would "run nowhere"; restored, it passes. The guard is itself in a
  globbed dir, so it only runs because the fix works.
  *Learning*: a config that enumerates files by name is a silent-no-op waiting
  to happen. Glob the directory, and add a test that fails if anyone reverts to
  enumeration — the guarantee has to live in a test, not a comment.

## REQ-15 — The API must be testable without the network  `done`

Every `packages/api` route that prices anything calls `getRates` with the
default (live) adapters. `createApp()` exposes no seam to inject offline
adapters, so an HTTP-level test can only avoid the network by not reaching the
pricing path at all. This is a test-hygiene gap, not a product bug — but it
made one test flaky.

### UC-15.1 — The rate-limit test must not depend on the network

- **T-15.1.1** `done` `refreshRates is rate-limited` looped up to 15 live
  `POST /v1/rates/refresh` calls (each `forceLive:true` → a real fetch) to trip
  the limiter, and timed out at 60s under parallel suite load while passing in
  isolation. Rewrote it to exhaust `refreshRatesLimiter` directly on the
  route's key first, so the first HTTP call already 429s with zero fetches, and
  moved the limiter's counting/window/retry-after coverage into a dedicated
  `rate-limit.test.ts` unit test (previously that behaviour was only exercised
  through the flaky HTTP loop).
  *Tests*: `rate-limit.test.ts` — allow-then-block, per-key isolation, window
  expiry (**edge** exactly one window later), retry-after math, reset;
  `openapi-rest.test.ts` — one HTTP call returns 429 + `Retry-After` + a
  problem+json body. Both network-free.

### UC-15.2 — Any route that prices should be drivable offline  `done`

- **T-15.2.1** `done` `createApp(deps?: { ratesOptions })` now forwards a
  rate-resolution seam to all four pricing call sites (`/v1/rates`,
  `/v1/rates/refresh`, `/v1/estimates`, `/v1/estimates/freeze`). Constructor
  injection, not per-request `c.set()` context vars — the seam is a static test
  substitution and mirrors the `ratesOptions` `createEstimate` already takes;
  `ratesOptions` is deliberately **not** read from the HTTP body (adapters and
  caches are not serialisable and must never be caller-controlled). Additive:
  `createApp()` with no args is byte-for-byte the old behaviour. `forceLive`
  from a refresh request still wins over injected options.
  *Tests* (`app-offline-seam.test.ts`): a `/v1/rates` GET and a `/v1/estimates`
  POST price from injected fallback adapters (ratesSource "fallback", positive
  finite total, **deterministic** across fresh apps and concurrent calls), no
  network; a freeze pins the offline card; the no-deps default still constructs.
  The `TODO(REQ-15)` marker is retired. (Both sessions wrote a seam test in
  parallel — `estimate-offline.test.ts` was dropped as the redundant twin of the
  more thorough `app-offline-seam.test.ts` during the merge.)
- **T-15.2.2** `done` **Global error net (research-led).** Two sessions built
  the seam independently; this half adds a single centralized
  [`app.onError`](https://hono.dev/docs/api/hono) — Hono's recommended pattern
  over a try/catch in every handler. Route-level handling still wins where
  present, so the per-route `problemJson(400)` fail-closed responses are
  untouched; the net only catches the *unexpected* throw that `/v1/rates` and
  `/v1/rates/refresh` (no local try/catch) used to leak as Hono's default bare
  500. It now renders as a **500 problem+json**.
  *Tests* (`app-offline-seam.test.ts`): an injected adapter that throws on
  `GET /v1/rates` surfaces as a 500 with `Content-Type: application/problem+json`
  and a parseable body — a response, not a hang.
  *Follow-on TODO (in code)*: `TODO(REQ-15, error-taxonomy)` at `onError` — a
  rate-feed outage is really an upstream failure (502/503), and `/v1/estimates`'s
  own catch maps an adapter throw to 400 alongside genuine validation refusals.
  Typed engine error classes (UpstreamRateError vs ValidationError) would let both
  sites pick the honest status. Out of scope for the seam itself.

## REQ-16 — Error responses must carry the media type the contract declares  `done`

Found while writing the T-15.2.1 edge test — the injected-throwing-adapter case
asserted the error's `Content-Type` and it came back wrong. **Two sessions found
this independently**, which is itself the argument for the learning below.

### UC-16.1 — A client that branches on `application/problem+json` sees it

- **T-16.1.1** `done` `openapi.yaml` declares `application/problem+json` for
  error responses and `problem.ts` builds RFC 7807 bodies, but every 400/429
  actually went out as `application/json`. Cause: a Hono gotcha — `c.json()`
  sets its own `Content-Type` and **overwrites** the value `problemJson` had
  set with `c.header()`. No test caught it because they only checked the JSON
  body's `status`, never the wire media type. Fixed `problemJson` to serialise
  with `c.body(JSON.stringify(...), status, { "Content-Type": ... })`, which
  keeps the media type on the wire, and left a comment naming the gotcha so it
  can't recur.
  *Tests*: the 400 path (`openapi-rest.test.ts` unknown-fields + validation),
  the 429 path (`openapi-rest.test.ts` rate-limit) and the 500 path
  (`app-offline-seam.test.ts` onError) all now assert `Content-Type` matches
  `application/problem+json` on the wire.
  *Learning*: `c.json()` in Hono clobbers a prior `c.header("Content-Type")`.
  For a non-default JSON media type, pass the header to `c.body(JSON.stringify)`
  — and assert the media type, not just the body, or a contract drift stays
  invisible.

## REQ-17 — An unexpected error must not leak its raw message to the client  `done`

Found by a read-only sweep of the just-merged global error net.

### UC-17.1 — A 500 response carries a correlation id, not internal detail

- **T-17.1.1** `done` The global `app.onError` net (REQ-15 T-15.2.2) rendered
  `err.message` verbatim into the 500 `detail`. For the *unexpected* throw that
  net exists to catch, that message is uncontrolled — an upstream provider's
  error text, an internal URL, stack-adjacent detail — so echoing it is CWE-209
  (information exposure through an error message) and directly contradicts this
  API's own stated contract, *"Never returns raw provider OData / price-list
  payloads"* (`app.ts` header; `sanitizeRatesResponse`). The 400
  validation/fail-closed paths are unaffected: their detail is domain-controlled
  and client-actionable (it names the field to fix), so it stays.
  Fixed the 500 net to log the real cause server-side (already keyed to the
  request id) and return a **stable generic** detail plus the request id in the
  RFC 7807 `instance` field and an `X-Request-Id` header, so an operator can
  find the real error in the logs and a client can quote the id to support.
  *Tests* (`app-offline-seam.test.ts`): a throwing adapter on `GET /v1/rates`
  still yields a 500 problem+json, but the body's `detail` **must not** contain
  the raw thrown message, **must** be the generic string, and `instance` +
  `X-Request-Id` are present and equal.
  *Learning*: split error detail by audience — a 4xx tells the client what they
  can fix (echo the domain reason), a 5xx tells them nothing they can act on, so
  echoing its raw text only leaks. Give 5xx a correlation id and keep the cause
  in the logs.
  *Follow-on (existing `TODO(REQ-15, error-taxonomy)`)*: `/v1/estimates`'s own
  catch maps a rate-adapter throw to a 400 with the raw message; once typed
  engine error classes separate an upstream outage from a validation refusal,
  the same "generic for upstream, specific for client-actionable" split should
  apply there too.

## REQ-18 — A persisted blob must not be trusted just because it parses  `done`

The earliest architecture sweep flagged this and it stayed open until now: the
one remaining fail-**open** in an otherwise fail-closed codebase.

### UC-18.1 — A stale localStorage estimate must not render after a contract change

- **T-18.1.1** `done` `loadEstimateCache` validated only that the top-level
  keys (`estimate`, `provider`, `cachedAt`) *existed*, never the shape of the
  cached `EstimateResponse`. The storage key is versioned (`:v1`) but bumped by
  hand, so a contract change that forgot the bump would let a blob written by an
  older build — with missing or renamed fields — parse and render as if it were
  a live estimate. `apps/web` has no schema validator (it consumes generated
  types only, so `as EstimateResponse` proves nothing at runtime), so added a
  hand-rolled structural guard that checks the load-bearing required fields
  (`provider`, `lineItems` array, `totals.expected` number, `confidence`,
  `modelVersion`, `ratesAsOf`, `inputHash`) and treats a drifted or partial blob
  as **absent** (`null`) so the app re-fetches, rather than fail open into a
  malformed render.
  *Tests* (`estimate-cache.test.ts`, new): valid round-trip; provider-mismatch
  → absent; corrupt/unparseable → null; **edge** a parseable blob missing
  required fields is rejected (the case the old presence-only check would have
  returned); **edge** a `totals.expected` of the wrong type is rejected.
  *Learning*: a versioned storage key only helps if something bumps it; a shape
  guard on read protects continuously without depending on anyone remembering.
  Validate persisted data against its current shape at the trust boundary, the
  same way the API validates an incoming request body.

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
| 2026-08-11 | Absent coerced to zero — multiplicand grain | **Found and fixed** (REQ-6.2). The REQ-6 guard accepted "at least one" driver, but ADS's two drivers are multiplicands: supplying only one let the other `?? 0` produce a silent $0. Guard now requires every listed driver; probed against the real engine to confirm the gap and the fix. |
| 2026-08-10 | Swallowed errors (`catch {}`) | Checked all 7. All legitimate: each converts a parse failure into an explicit typed error or Problem response. No change. |
| 2026-08-10 | `as any` / unchecked casts | None in engine, API or web. |
| 2026-08-10 | Remaining `?? 0` | Only where a guard has already rejected the absent case (documented at the site), or where 0 is the correct reading of an absent protobuf field in the GCP catalog parser. **Updated 2026-08-11:** the ADS `?? 0`s are now fully guard-protected (REQ-6.2 requires both drivers). One inert case remains and is flagged with a TODO: `avgImageGB ?? 0` in the registry block feeds only the disabled cross-region pull path, so it changes no total. |
| 2026-08-10 | Unexplained magic numbers | Moved to `estimator-defaults.ts` with provenance per constant (REQ-5). |
| 2026-08-11 | Tests that pin a fixture date but not the clock | **Found and fixed — third instance of this class.** `rates-module.test.ts` pinned `now` on the *adapters* but not on `getRates`, which stamps `ageDays` with its own clock. The assertion compared a wall-clock `ageDays` against a `NOW`-derived one; they agreed only while the real date shared a day with the fixture's `capturedAt`, then started failing the first run after midnight UTC. Confirmed pre-existing by stashing all in-flight work and reproducing on clean `HEAD`. The sibling `price-freshness.test.ts` already pinned `now` at every call site, so the fix matched an existing pattern rather than inventing one. Swept the remaining `getRates`/`createEstimate` test call sites: no others unpinned. |
| 2026-08-11 | Unit tests that reach the live network for rates | **Found and fixed.** `create-estimate-mvp.test.ts` (all 5 `createEstimate` calls) and `tf-audit-reconciliation.test.ts` (the discovery-only case) had no offline rate seam, so each fell through to a live `getRates` fetch. The discovery-only assertion — which does no pricing math at all — timed out at 5s under full-suite load, presenting as a failure in unrelated in-flight work. Threaded the established `OFFLINE_RATES` seam (forceFallback adapters + fresh cache + pinned `now`) through both; test time dropped from 5.4s-with-timeout to ~35ms and is now deterministic. Swept every `createEstimate`-calling test: the remaining apparent gaps (`price-validation`, `capability-drivers`) spread a shared already-seamed `inputs`/`base` object, so they were never live. *Rule*: a unit test must never depend on `getRates` reaching the network — inject `ratesOptions` with `forceFallback` adapters, even when the assertion is purely structural, because a $0/no-op path still makes the fetch. |
| 2026-08-11 | Config that enumerates test files by name (silent no-op) | **Found and fixed (REQ-14).** `vitest.config.ts` hand-listed the two shared test dirs file-by-file; a new file in either would run nowhere. A `TODO(test-discovery)` had flagged it. Globbed both dirs and added `test-discovery.test.ts` to fail if anyone reverts to enumeration. Latent, not yet firing — all files were listed — but one added test away from a false green. |
| 2026-08-11 | API tests reaching the live network (REQ-15) | **Found and fixed.** `refreshRates is rate-limited` looped up to 15 live refresh POSTs and timed out under parallel load (passed in isolation). Rewrote it to pre-exhaust the limiter (0 fetches) and moved counting coverage to a unit test. Then closed the root cause: `createApp(deps?: { ratesOptions })` now injects an offline rates seam into every pricing route (T-15.2.1), exercised in `app-offline-seam.test.ts`. |
| 2026-08-11 | Error responses sent as `application/json`, not `application/problem+json` (REQ-16) | **Found and fixed.** The OpenAPI contract and `problem.ts` promise RFC 7807, but every 400/429 went out as `application/json` because Hono's `c.json()` overwrote the Content-Type `problemJson` set via `c.header()`. Invisible because tests only checked the JSON body's `status`, never the wire media type. Surfaced by the T-15.2.1 edge test. Fixed `problemJson` to `c.body(JSON.stringify(...))`; both the 400 and 429 paths now assert the media type. *Rule*: assert the media type on error responses, not just the body — and know `c.json()` clobbers a prior `c.header("Content-Type")`. |
| 2026-08-11 | 500 error echoing the raw exception message (CWE-209, REQ-17) | **Found and fixed.** The just-merged global `onError` net put `err.message` verbatim into the 500 body — for the unexpected throw it catches, that is uncontrolled text (upstream provider errors, internal URLs) and contradicts the API's own "never expose raw provider payloads" contract. Fixed to a generic 500 detail + a request id (`instance` + `X-Request-Id`), real cause in the logs. *Rule*: 4xx detail is for the client to act on (echo the domain reason); 5xx detail is not (give a correlation id, log the cause). |
| 2026-08-11 | Persistence drift — cache trusted by presence, not shape (REQ-18) | **Found and fixed** (the earliest sweep flagged it; it stayed open). `loadEstimateCache` returned any blob with the right *keys*, never checking the `EstimateResponse` *shape*, so a contract change without a manual `:v1` key bump would render a stale, differently-shaped estimate. Added a fail-closed structural guard on read. *Rule*: validate persisted data against its current shape at the trust boundary — a versioned key only helps if someone remembers to bump it. |
| 2026-08-11 | GCP fallback prices carrying stale/discounted rates | **Found and fixed.** Two GCP meters were wrong: `pd-snapshot-storage` held the pre-2023 price ($0.026 vs current $0.05, ~2x under), and `gce-outpost-scanner` held a sustained-use-discounted rate ($0.0475) instead of the on-demand rate ($0.067) an ephemeral VM should pay. Both surfaced by verifying against vendor docs (REQ-2). *Rule*: a fallback price is a claim with an expiry — a `capturedAt` far in the past on a `verified`/`unverified` row is a re-check due, and "priced as underlying X" / a discounted headline rate are both smells worth a vendor read. |
| 2026-08-11 | Response helper that lies about its own media type | **Found and fixed (REQ-15).** `problemJson` set `Content-Type: application/problem+json` then called `c.json()`, which hard-sets `application/json` and silently overrode it, so every 400/429 error response shipped the wrong RFC 7807 media type. Invisible because no test asserted the content-type — the first assertion (the REQ-15 onError test) caught it immediately. Switched to `c.body(JSON.stringify(body), status, { … })`; regression-locked on the 400/429/500 paths. *Rule*: `c.json()` owns the content-type — a custom media type must go through `c.body()`, and a header helper deserves at least one test that reads the header it sets. |
| 2026-08-11 | "Blocked on an external API key" taken at face value (REQ-2/REQ-4) | **Challenged and dissolved.** Two GCP meters sat `unverified` with a `blockedReason` that amounted to "needs the Cloud Billing Catalog API key". Researching public sources showed: (a) the old keyless `pricelist.json` feed is decommissioned (404), so no keyless *machine* feed exists; but (b) the authoritative source is the official Google pricing doc itself, which the ledger already models as `method: "official-doc"`. Re-confirmed both values against the official doc + multiple independent references ($0.05/GB-month snapshot; $0.067/hr e2-standard-2) and moved them to `verified`. Every billable meter on all three clouds is now vendor-backed. *Rule*: "we need an API key" is a claim to verify, not accept — the authoritative source may be a document, not an endpoint, and a scheduled human re-read is real coverage. |
| 2026-08-11 | Web-layer sweep: unchecked casts on parsed/persisted data | **Mostly clean; one fixed (REQ-18).** Audited every `JSON.parse(...) as T` and `Number(...)` in `apps/web`. The share-state restore path already re-validates through `validateShareState` (safe), the calibration cast is a post-guard union-narrowing (safe), and `billingCsv` guards `Number.isFinite` (safe). The exception: `loadEstimateCache` presence-checked but did not structurally validate the cached estimate before rendering it — a **persistence-drift** hole across app versions (both sessions found it independently; fixed as REQ-18 via `isEstimateResponseShape`, fail-closed to a cache miss). *Rule*: persisted state is external input on the next app version even when it is self-authored on this one — validate it as strictly as any wire input. |

**Standing rule this class earned**: when a test pins a clock, pin it on *every*
collaborator that reads one — pinning the adapter but not the orchestrator
leaves a test that passes today and fails on a date boundary, which reads as a
regression in whatever change happens to be in flight. Prior instances: the two
`rate-pinning` suites (30 days after their fixture `capturedAt`).

# Part C — Ideation

Deliberately separated from the backlog above: these are directions, not
commitments. Each notes what would have to be true to make it worth doing.

## Short term (weeks) — sharpen what exists

| Idea | Why | Worth it when |
| --- | --- | --- |
| Estimate diffing | "What changed since last quote, and which meter caused it?" is the first question every reviewer asks. Freeze exports already pin everything needed to diff two runs. | Anyone re-quotes an account more than once. |
| Confidence-weighted totals | A total that mixes a verified Event Hubs line with an invented ACR line reads as one number. Weighting, or splitting the total into *vendor-backed* and *modelled*, keeps the honesty visible in the headline. | Modelled capabilities stay in the product. |
| Per-line "show the arithmetic" | The notes now carry object and operation counts; rendering them under each line removes the last reason to read the source. | REQ-1 ships. — **Partly shipped (2026-08-11):** the cost breakdown now shows a per-line **Source** column — a "✓ verified" link to the official vendor page for a vendor-backed rate, or the ledger verdict for one that isn't (`CostBreakdown`, `MeterVerification` was already on the response). The arithmetic *notes* (object/op counts) still need a `LineItem.notes` field added to the OpenAPI contract + engine passthrough before the UI can render them — deferred. |
| Ledger freshness badge in the UI | The engine knows each rate's age; the UI still shows one global banner. | Cheap once verification reaches the response, which it now does. — **Shipped (2026-08-11):** the per-line Source badge flags a trusted-but-**stale** rate ("⚠ verified · stale", still linked to the source, with the age in the tooltip) using `verification.stale`/`ageDays` already on the response. No cross-package mirror. |
| Client-side sizing pre-flight | The engine now rejects an enabled capability that is missing a required driver (REQ-6.2), surfaced as a 400. The web form could run the same `findUnsizedCapabilities` rule *before* Run and highlight the empty field inline. | **Declined (2026-08-11) — would add cruft.** The UI sends every driver as an explicit number (state defaults to 0), so the engine never actually 400s on the UI path: it prices $0 **and already emits a "driver=0, verify intentional" warning** that the breakdown surfaces as a placeholder note, near-instant under auto-run. A pre-Run nudge would duplicate that existing feedback *and* require mirroring the engine capability→driver map into `apps/web` (a drift risk against the repo's one-source-of-truth discipline). Not worth the maintenance cost for a signal the operator already gets. Revisit only if the map is exposed over the API (e.g. on `/v1/capabilities`) so no mirror is needed. |

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

All three have been resolved. Two were superseded abstractions that deserved a
job rather than a delete; one was actively misleading and is gone.

| Symbol | File | Decision |
| --- | --- | --- |
| `kinesisPutPayloadMillions` | `providers/aws/aws-stream-estimator.ts` | **Resolved — now used.** The estimator repeated its body inline (`putUnits / 1_000_000`). The helper is called instead, so there is one implementation with a name. |
| `AzureTfAuditBillableMeter` | `providers/azure/tf-audit-reconciliation.ts` | **Resolved — now used** as the return type of `azureAuditMapMeterIds()`. Typing it immediately surfaced a looseness the build caught, which is the argument for using a type rather than parking it. |
| `StorageRedundancy` | `providers/storage/audit-storage.types.ts` | **Resolved — deleted.** Referenced nowhere, and its members (`"Standard"`) disagreed with what the providers enforce (`"STANDARD"`), so a reader who trusted it would have been misled. `assertAllowedRedundancy` takes `readonly string[]` and normalises case, so it added no safety. A comment records why. |

Two symbols added in the previous change were unused and have been removed
rather than left for approval, since they were mine and never shipped:
`UNTRUSTED_VERDICTS`, `deployedMetersFor`.

The 53 over-exported symbols are not dead — they are used inside their defining
file but exposed anyway. They widen the package's public surface and make
refactoring harder than it needs to be. Tracked as REQ-8; not urgent.

## New findings this session — all resolved (2026-08-11)

Found via a dead-code/unfinished-feature audit (export-usage cross-reference
across all three packages + `apps/web`). Originally parked for human approval;
with that approval given ("decide yourself"), every row is now dispositioned —
most were **finished** by concurrent work rather than deleted, which is the
outcome the audit hoped for (a started feature getting wired up beats a delete):

- **Freeze-export** (`freezeEstimate`/`loadFrozenEstimate`/`validateExportSchema`)
  — **FINISHED.** `POST /v1/estimates/freeze` and `/v1/estimates/reload` routes
  now expose the whole pin/reload-and-verify cycle (`app.ts`); the seam that used
  to make it unreachable is gone.
- **`HowToUseEstimator`** — **DELETED** (superseded by `JourneyIntro`; the file
  and its dead CSS are gone).
- **`loadLastShareState`** (+`readLocalJson`) — **FINISHED.** Wired into
  `EstimatorPage.tsx` bootstrap, so the write path now has a matching read/restore.
- **`AWS_TF_PRESENT`/`GCP_TF_PRESENT`** — **WIRED.** `tf-honesty-warnings.ts` now
  branches on the flags (`provider === "aws" ? AWS_TF_PRESENT : GCP_TF_PRESENT`)
  instead of a hardcoded provider-name check, so the flags are load-bearing and
  the no-TF-inventory note has one source of truth (a REQ-9 dedup, with a test
  that flips a flag to `true`).
- **`capabilityForAffectsField`** — **DELETED** (tf-grounding.ts refactored;
  the function no longer exists).
- **`CAPABILITY_LABELS`** — **DELETED** (deprecated bridge, zero callers).
- **`DeprecatedForce`** query param — **DELETED** from `openapi.yaml`; generated
  types regenerated (drift check green), so the contract no longer advertises a
  no-op parameter.

Historical detail retained below for provenance; every "Recommendation" has now
been carried out.

| Symbol / area | File | What it looks like | Recommendation |
| --- | --- | --- | --- |
| `freezeEstimate` / `loadFrozenEstimate` / `rateCardFromFreeze` / `validateExportSchema` (the rate-pinning "freeze export" module) | `core/rate-pinning.ts` | A complete, well-tested pin/freeze/reload-and-verify cycle, documented in `docs/CLOUD_COST_MODEL.md` as a real use case ("Reproducible export … Frozen rates + modelVersion"). No HTTP route exposes it (`openapi.yaml` has no `/estimates/freeze` or `/reload` path) and `apps/web` never imports cost-engine directly, so the capability is unreachable from any caller today. Only `createInputHash`/`estimateExportFields` (2 of ~8 symbols) are actually consumed, by `create-estimate.ts`. | **FINISH** (add `POST /v1/estimates/freeze` + `/reload` routes and wire the existing "Freeze rates snapshot" UI button to them) **or DELETE** the unreachable half, keeping only the 2 symbols in real use. Genuinely looks like an intentionally-started feature, not an accident — needs a product decision on whether "freeze and reproduce a quote later" ships. |
| `HowToUseEstimator` | `widgets/HowToUseEstimator/HowToUseEstimator.tsx` | Zero references anywhere outside its own file. `JourneyIntro.tsx`'s own comment says it "replaces long scroll how-to" and reuses the same `data-testid="how-to-use-honesty"` for its closing paragraph — direct evidence it superseded this component during a UX rework, and the old file was never deleted. Its CSS (`.how-to-use__steps`) is dead too. | **DELETE.** High confidence — superseded, zero references, corroborating comment in the replacement component. |
| `loadLastShareState` (+ `readLocalJson`) | `shared/lib/safe-storage.ts` | The read-back half of a write/read pair: `saveLastShareState` **is** called (`EstimatorPage.tsx` `onCopyShareLink`, as a local backup whenever a share link is copied), but nothing ever calls `loadLastShareState` to restore it — e.g. as a fallback when the `?s=` URL param is missing or truncated. Looks like a safety-net feature that shipped half-wired: write path done, read/restore path never connected. | **FINISH** (call it during bootstrap when no `?s=` param is present) **or DELETE** (drop the read half and `readLocalJson` if the recovery UX isn't wanted) — a small, cheap decision either way. |
| `AWS_TF_PRESENT` / `GCP_TF_PRESENT` | `providers/{aws,gcp}/capability-meter-map.ts` | Both hardcoded `false`, re-exported publicly, referenced only by their own declaration, the package re-export, and a test that asserts `toBe(false)`. No conditional anywhere reads either flag — `tf-honesty-warnings.ts` reimplements the same "AWS/GCP have no TF inventory" fact via a hardcoded provider-name check instead of consulting these flags. Inert today because both providers' Terraform readiness genuinely is "not yet" (see `docs/CLOUD_COST_MODEL.md`'s provider-readiness table — this is intentional placeholder state, not a mistake), but the flags currently do nothing. | **UNCLEAR** — either wire `tf-honesty-warnings.ts` to branch on the flag (so it becomes meaningful the day AWS/GCP Terraform lands) or remove the flags and keep the hardcoded check. Lower priority than the other three rows. |
| `capabilityForAffectsField` | `shared/model/tf-grounding.ts` | Zero references anywhere, including within its own file. `shared/lib/affects-chips.ts` (a later addition per its own package-number comment) independently reimplements the same "which volume field maps to which capability/meters" concept with its own field list. The constant it reads (`AUDIT_AFFECTS_FIELD_IDS`) is still used elsewhere — only the function itself is dead. | **DELETE.** High confidence — superseded by `affects-chips.ts`, zero references, the one thing it reads is used elsewhere so nothing else breaks. |
| `CAPABILITY_LABELS` | `widgets/CapabilityToggles/CapabilityToggles.tsx` | Already carries an `@deprecated` tag ("Prefer `capabilityLabel()` — kept for callers expecting short names"), but an export-usage cross-reference across all three packages + `apps/web` finds **zero callers** — the migration it was left as a bridge for is complete. It only calls `capabilityLabel()` per key, so deleting it removes a table nothing reads. | **DELETE.** High confidence — self-declared deprecated, zero references. Found in the 2026-08-11 back-compat sweep. |
| `DeprecatedForce` query param | `openapi/openapi.yaml` (`/rates/refresh`) → generated `openapi.types.ts` | A `deprecated: true` query parameter documented as a "Deprecated no-op; use body.forceLive". The route reads `forceLive` from the JSON body; the query param does nothing, and no client (`apps/web` or tests) ever sends it. A pure backward-compat husk in the API contract with no senders to break. | **DELETE** from `openapi.yaml` and regenerate types — or keep only if an external (non-`apps/web`) client is known to still pass it, which nothing in-repo does. Found in the 2026-08-11 back-compat sweep. |
