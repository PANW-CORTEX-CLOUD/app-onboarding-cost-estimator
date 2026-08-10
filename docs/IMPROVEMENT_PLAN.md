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

## REQ-3 — Volume tiers and free allowances must not be silently ignored  `todo`

Several verified meters are only the **first** tier of a graduated price, and
several services have free grants the estimator never applies. Large estates are
over-estimated and small ones over-estimated again — both wrong, in opposite
directions.

### UC-3.1 — A 200 TB estate is not billed at the first-tier rate throughout

- **T-3.1.1** `todo` Model graduated tiers for `blob-hot-lrs-capacity`,
  `s3-standard-storage`, `aws-egress-gb`, `gcp-egress-gb`. The ledger already
  captures the tier table in `observed.tiersSeen`.
  *Tests*: a volume spanning two tiers bills each at its own rate; **edge** a
  volume exactly on a tier boundary does not double-count.
- **T-3.1.2** `todo` Apply free allowances (Azure 100 GB/month egress, Pub/Sub
  first 10 GiB, Lambda first 1M requests) behind an explicit
  `applyFreeAllowances` flag, defaulting **off** so quotes stay conservative.
  *Tests*: flag off reproduces today's totals exactly; flag on subtracts the
  documented grant.

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

## REQ-5 — Defaults must be named, centralised and visible  `doing` (T-5.1.1 done)

`create-estimate.ts` scatters unexplained literals: `730`, `10`, `4`, `24`,
`1`, `0.01`. A reader cannot tell which are conventions, which are guesses, and
which would change a customer's quote.

- **T-5.1.1** `done` Move them into a documented `estimator-defaults.ts` with a
  sentence per constant explaining where the number comes from.
  *Tests*: defaults are re-exported and asserted; totals unchanged.
- **T-5.1.2** `todo` Distinguish *convention* defaults (730 hours) from
  *assumption* defaults (10 accounts, 4 scans). Assumptions should appear in the
  estimate's assumption snapshot so the customer sees what was guessed.

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

---

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
