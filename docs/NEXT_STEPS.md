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
| **verified** | 26 | The vendor publishes this exact price for this exact unit. |
| **proxy** | 2 | The number is officially correct but comes from a different service's price list than the meter claims. |
| **unsupported-meter** | 4 | The vendor publishes no such meter. The number was invented by this repo. |
| **unverified** | 1 | Cannot be checked as written. |

The 7 non-verified meters are forced to Low-confidence bands and each raises a
named warning on any estimate that touches them. None of them can produce a
High-confidence figure any more.

### Prices that were wrong and are now fixed

| Meter | Was | Now | Why |
| --- | --- | --- | --- |
| `blob-hot-lrs-write-10k` (Azure) | 0.055 | **0.05** | Retail Prices API: `Hot LRS Write Operations` is $0.05 per 10K. |
| `s3-put-10k` (AWS) | 0.005 | **0.05** | The repo held the per-**1,000** price under a per-**10k** meter id — a 10× understatement. |
| `s3-get-10k` (AWS) | 0.0004 | **0.004** | Same mistake: `Requests-Tier2` is $0.004 per 10,000. |
| `gcs-standard-storage` (GCP) | 0.020 | **0.022** | 0.020 is the pre-2024 regional rate; us-central1 Standard is $0.022/GB-month. |
| `pubsub-message-delivery` (GCP) | 0.04 | **0.0390625** | The official SKU is $40 per **TiB**; 40/1024, not a rounded 0.04. |

### Prices that are still not real

These four are **not vendor meters**. They are placeholders, and the estimator
now says so on every line that uses them.

| Meter | Claim | What the vendor actually charges |
| --- | --- | --- |
| `acr-pull-bandwidth` (Azure) | $0.01/GB pull | ACR bills a Registry Unit per day plus $0.10/GB-month stored. Egress bills through **Bandwidth**, and same-region pulls are free. There is no per-GB pull SKU. |
| `s3-data-retrieval-band` (AWS) | $0.0004/GB retrieval | **S3 Standard has no retrieval fee.** Retrieval charges exist only for IA and Glacier classes. The number is the per-1,000 GET price reused as a per-GB rate. |
| `pd-snapshot-storage` (GCP) | $0.026/GB-month | Standard snapshots are priced as the *underlying disk type*, so no single constant is right. Archive snapshots are $0.019 regional / $0.024 multi-regional. |
| `gcs-data-read-band` (GCP) | $0.12/GB read | **Cloud Storage has no per-GB read charge.** In-region reads cost Class B operations only; $0.12/GB is the internet egress rate. |

And two that are numerically right but wrongly attributed: `ecr-data-transfer`
and `artifact-registry-egress` both carry the *network egress* rate while
naming the registry's price list.

---

## 2. Work items, in priority order

### P0 — DSPM multiplies gigabytes by a per-operation price

`providers/dspm/estimate-dspm-core.ts` computes:

```ts
expected = scannedGB * readRate;   // readRate is $/10k operations on Azure
```

`blob-data-read-ops` is **$0.004 per 10,000 operations**, not per GB. Gigabytes
times a per-operation rate is not a currency amount — the Azure DSPM figure is
dimensionally meaningless, whatever the price says. AWS and GCP avoid the unit
error only by using the invented per-GB meters in the table above, so all three
providers are wrong for different reasons.

The fix needs one new input, because the conversion is genuinely unknowable
without it: **average scanned object size**. Then

```
readOps  = scannedGB * 1024 / avgObjectSizeMB
expected = readOps / 10_000 * ratePer10kOps          (+ egress, only when the scanner is out-of-region)
```

Do this per provider: Azure `blob-hot-lrs-read-10k`, AWS `Requests-Tier2`
(`s3-get-10k`), GCP `gcs-class-b-10k` — all three are **already verified** and
already in the rate files, so no new price research is needed. Delete
`s3-data-retrieval-band` and `gcs-data-read-band` once nothing references them.

Ship it behind an explicit input rather than a silent default: if
`avgObjectSizeMB` is missing, fail closed the way DSPM already fails closed on
empty discovery telemetry. Update `providers/dspm/__tests__/dspm.test.ts` and
the three golden fixtures in the same change.

### P1 — Registry scan on Azure has no priceable model

`acr-pull-bandwidth` cannot be fixed by finding a better number, because the
meter does not exist. Model what ACR actually charges instead:

- a Registry Unit per day for the SKU tier (Standard $0.6666/day), and
- egress via `azure-egress-gb` **only** when `crossRegionPull` is true.

The cross-region gate is already implemented and already yields $0 for
same-region pulls, so the change is confined to the meter choice.

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

### P4 — Volume tiers are not modelled

Several verified meters are the *first* tier of a graduated price:
`blob-hot-lrs-capacity` (0.0208 up to 50 TB, then 0.019968 / 0.019136),
`aws-egress-gb` (0.09 up to 10 TB, then 0.085 / 0.070 / 0.050),
`s3-standard-storage` (0.023 for the first 50 TB), `gcp-egress-gb` (first
tier). The ledger records the tiers it saw in `observed.tiersSeen`. Large
estates are therefore over-estimated, which is the safe direction, but it
should be modelled rather than left implicit. Free allowances (Azure's 100
GB/month egress, Pub/Sub's first 10 GiB, Lambda's first 1M requests) are
likewise not modelled.

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
