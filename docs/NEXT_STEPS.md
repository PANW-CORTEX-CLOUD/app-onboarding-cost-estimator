# What is true, what is not, and what to do next

Status of the cost estimator's correctness work as of **2026-08-10**.

Every rate the estimator can bill was compared against the provider's own
price list on that date. The results live in
[`sources/price-validations.json`](../sources/price-validations.json) — one row
per meter, each recording the claim, the observed official figure, the probe
that produced it, and when the check happened.

Two commands own this:

```bash
pnpm rates:validate          # re-crawl only the meters that are past their re-check window
pnpm rates:validate --write  # persist the new verdicts
pnpm rates:validate-check    # offline CI gate (runs inside `pnpm test`)
pnpm tf:manifest             # re-derive what the Terraform deploys
```

---

## 1. Scoreboard

| | Count | Meaning |
| --- | --- | --- |
| **verified** | 27 | The vendor publishes this exact price for this exact unit. |
| **retired** | 6 | Billed by nothing. Kept as a record so the claim stays falsifiable and the crawler keeps re-checking it. |
| **still billed but not vendor-backed** | 2 | Both GCP: `pd-snapshot-storage`, `gce-outpost-scanner`. |

Of the 34 ledger rows, 6 are retired and no longer priced at all. Of what
remains billable, **Azure and AWS are fully vendor-verified**; the two GCP
exceptions are forced to Low-confidence bands and each raises a named warning.

### Prices that were wrong and are now fixed

| Meter | Was | Now | Why |
| --- | --- | --- | --- |
| `blob-hot-lrs-write-10k` (Azure) | 0.055 | **0.05** | Retail Prices API: `Hot LRS Write Operations` is $0.05 per 10K. |
| `s3-put-10k` (AWS) | 0.005 | **0.05** | The repo held the per-**1,000** price under a per-**10k** meter id — a 10× understatement. |
| `s3-get-10k` (AWS) | 0.0004 | **0.004** | Same mistake: `Requests-Tier2` is $0.004 per 10,000. |
| `gcs-standard-storage` (GCP) | 0.020 | **0.022** | 0.020 is the pre-2024 regional rate; us-central1 Standard is $0.022/GB-month. |
| `pubsub-message-delivery` (GCP) | 0.04 | **0.0390625** | The official SKU is $40 per **TiB**; 40/1024, not a rounded 0.04. |

### Prices that are still not real

These three are **not vendor meters**. They are placeholders (all now retired),
and the estimator says so on every line that uses them.

| Meter | Claim | What the vendor actually charges |
| --- | --- | --- |
| `acr-pull-bandwidth` (Azure) | $0.01/GB pull | ACR bills a Registry Unit per day plus $0.10/GB-month stored. Egress bills through **Bandwidth**, and same-region pulls are free. There is no per-GB pull SKU. |
| `s3-data-retrieval-band` (AWS) | $0.0004/GB retrieval | **S3 Standard has no retrieval fee.** Retrieval charges exist only for IA and Glacier classes. The number is the per-1,000 GET price reused as a per-GB rate. |
| `gcs-data-read-band` (GCP) | $0.12/GB read | **Cloud Storage has no per-GB read charge.** In-region reads cost Class B operations only; $0.12/GB is the internet egress rate. |

### A real meter whose value we can't machine-verify

`pd-snapshot-storage` (GCP) **is** a real vendor meter — corrected 2026-08-11.
It was previously listed above as "not a vendor meter" on the belief that
standard snapshots are priced by the underlying disk type. That belief is
**refuted** by docs.cloud.google.com/compute/docs/disks/snapshots: snapshot
storage is a *single flat rate on the total (compressed, incremental) snapshot
size*, so one meter is the right shape. The old value `$0.026/GB-month` was the
pre-2023 regional price; GCP raised us-central1 regional standard-snapshot
storage to **$0.05/GB-month** on 2023-04-01, and that is now the fallback value.
It stays `unverified` (Low confidence + warning on every ADS line) only because
the pricing page is client-rendered and Google publishes no keyless feed to
confirm the exact figure — the same limitation as `gce-outpost-scanner`.
Archive snapshots ($0.019 regional / $0.024 multi-regional) are a separate SKU
this estimator does not model.

And two that are numerically right but wrongly attributed: `ecr-data-transfer`
and `artifact-registry-egress` both carry the *network egress* rate while
naming the registry's price list.

---

## 2. Work items, in priority order

### ~~P0 — DSPM multiplies gigabytes by a per-operation price~~ — fixed 2026-08-10

`providers/dspm/estimate-dspm-core.ts` computed `scannedGB x ratePer10kOps`,
which is not a currency amount. It now converts the estate to an object count
and prices the API calls a scanner really makes:

```
objects  = scannedGB * 1024 / avgObjectSizeMB
readOps  = objects                            one Get Blob per object
listOps  = ceil(objects / pageSize)           paginated enumeration
cost     = readOps/10_000 * readRate + listOps/10_000 * listRate
```

Grounded in Microsoft's own documentation: `Get Blob` is a Read operation and
costs **one operation per blob regardless of size**, `List Blobs` bills as the
dearer "list and create container" class, and **hot-tier retrieval is free** —
so there was never a per-GB meter to use. S3 Standard and Cloud Storage behave
the same way.

All six meters involved were already verified: `blob-hot-lrs-read-10k`,
`blob-hot-lrs-list-10k` (added and live-verified at $0.05/10K), `s3-get-10k`,
`s3-put-10k`, `gcs-class-b-10k`, `gcs-class-a-10k`. The three invented per-GB
meters (`blob-data-read-ops`, `s3-data-retrieval-band`, `gcs-data-read-band`)
are no longer billed by anything; they stay in the ledger as
`unsupported-meter` so the claim remains recorded and falsifiable.

**Effect on quotes.** A 51,200 GB estate at 25% scanned, 4 MB average object:
old model $51.20/month, new model $1.31 — the old figure was about 39x too
high because it charged per gigabyte for something billed per call.

`avgObjectSizeMB` is a new input on the API and in the driver step, defaulting
to 4 MB and always stated in the estimate notes.

### ~~P1 — Registry scan has no priceable model~~ — fixed 2026-08-10

Not by finding a better number, but by establishing there is no charge to find.
Microsoft states plainly that pulling images carries **no per-GB fee**: an ACR
bill is the registry SKU plus storage plus standard network egress. The SKU and
storage are infrastructure the customer already runs, so onboarding Cortex adds
nothing there — only egress, and only when the scanner is out-of-region.

`acr-pull-bandwidth`, `ecr-data-transfer` and `artifact-registry-egress` are
retired. Registry scanning now bills `azure-egress-gb` / `aws-egress-gb` /
`gcp-egress-gb`, all verified, and same-region scanning is $0 — which is what
actually happens.

**Azure and AWS now have no non-verified meters at all.** Every rate either
cloud can bill has been read from the vendor's own price list. Only GCP retains
two, both below.

### P2 — Name the GCP scanner machine type

`gce-outpost-scanner` claims $0.0475/hour with no machine type recorded, so no
probe can confirm or refute it. Azure names D2s v3 and AWS names t3.medium;
GCP must name one too (e2-standard-2 is the closest analogue at 2 vCPU / 8 GB).
This is the only `unverified` row and the only one carrying a `blockedReason`.

### P3 — GCP prices cannot be crawled at all

Azure's Retail Prices API and AWS's Price List API are public and keyless, so
11 Azure and 11 AWS meters re-verify automatically. Google's Cloud Billing
Catalog API needs an API key and the pricing pages render client-side, so all
11 GCP meters fall back to a manual re-read every 90 days — the crawler prints
the exact list and the last recorded quote. Wiring a Billing Catalog key into
CI would close the last gap.

### ~~P4 — Volume tiers are not modelled~~ — fixed 2026-08-10

Four meters now carry their published ladders, with boundaries read from the
vendors' machine-readable feeds rather than transcribed:

| Meter | Boundaries (units) |
| --- | --- |
| `blob-hot-lrs-capacity` | 0 / 51,200 / 512,000 |
| `s3-standard-storage` | 0 / 51,200 / 512,000 |
| `azure-egress-gb` | 0 / 100 / 10,335 / 51,295 / 153,695 |
| `aws-egress-gb` | 0 / 10,240 / 51,200 / 153,600 |

A 200,000 GB audit store now costs $4,036.20/month instead of $4,160.00. Small
estates are unchanged.

`gcp-egress-gb` stays flat: Google publishes no keyless feed, so its boundaries
cannot be verified, and guessing them would be exactly the invention this work
exists to remove.

**Free allowances are opt-in.** Azure publishes its 100 GB egress allowance as a
$0 band, but the allowance is granted per subscription and shared across every
service in it — so the default assumes it is already spent, and
`applyFreeAllowances` opts in.

---

## 3. How the guarantees are enforced

Everything above is held in place by gates that run in `pnpm test`:

| Gate | Enforces |
| --- | --- |
| `validate-prices.mjs --check` | Every priced meter has a ledger row; no row is `mismatch`; nothing is past its re-check window; the rate files and the ledger agree meter-for-meter. |
| `derive-tf-manifest.mjs` | The checked-in TF manifest still matches `azure/data`. Toggle a module in `template_version` and this fails until the estimate follows. |
| `price-validation.test.ts` | Meters derived by walking the Terraform equal the hand-kept audit allowlist; as-deployed mode bills only deployed meters; non-vendor rates cannot be High confidence. |
| `scope-overview.test.tsx` | The deployability badges in the UI match the derived manifest. |
| `check-fallback-prices-age.mjs` | No `capturedAt` older than 90 days. |

Two behaviours worth knowing about:

- **`capturedAt` no longer moves on its own.** `refresh-fallback-prices.mjs`
  used to stamp every meter to "now" without reading a single price, which made
  stale numbers look fresh and silently satisfied the age gate. It now only
  validates; `--stamp` copies dates from the ledger's `verifiedAt`, and the
  test suite asserts that running it changes nothing.
- **A price nobody can check does not fail CI forever.** A row with a
  `blockedReason` resets its clock on the *attempt* rather than the
  verification, but stays untrusted, so it still forces Low confidence and
  still warns.

---

## 4. Terraform ↔ estimate

`sources/tf-feature-manifest.json` is derived by walking `azure/data`: a module
counts as deployed when it is listed in `template_version` **and** its `.tf`
declares resources. Today that yields exactly three billable meters —
`eh-standard-tu`, `eh-standard-ingress-events`, `blob-hot-lrs-capacity` — which
independently reproduces the hand-maintained allowlist in
`tf-audit-reconciliation.ts`.

Estimates take a `tfMode`:

- **`as-deployed`** prices only what `terraform apply` will create. Capabilities
  the Terraform does not deploy are dropped before any estimator runs, and are
  listed in `excludedCapabilities` with the reason. This is the number to
  compare against a first invoice.
- **`what-if`** (default) also prices capabilities with no connector Terraform,
  labelled as modelled.

`DISCOVERY-assets_discovery.tf` is 0 bytes, so discovery is `not-deployed` and
contributes $0 — not "unknown".

AWS and GCP have no connector Terraform in this repo. `as-deployed` there
prices nothing at all, deliberately: there is no IaC to be faithful to.
