# Customer cost plan file

A customer (or SE on their behalf) can fill in a spreadsheet and upload it to the
estimator to get a cost — no need to click through the tool. This is the format
of that file.

## How to use it

1. In the estimator, open **Inputs → Import** and click **Download plan
   template**. You get `cortex-cost-plan-template.csv`.
2. Open it in Excel (or any spreadsheet / text editor). It is a two-column
   `key,value` sheet, pre-filled with a realistic example.
3. Edit the **value** column: turn capabilities on/off, enter your volumes.
   Do **not** rename the keys. Save as CSV.
4. Back in the estimator, **Import inputs CSV** and pick your file. The tool
   validates it, applies it, and shows the cost. Nothing is priced from a number
   the vendor does not publish.

Excel opens and saves `.csv` natively (File → Save As → CSV), so "fill it in
Excel" works without any special export. A binary `.xlsx` is intentionally **not**
required — it would need a third-party parser, and this project keeps its
dependency surface (and supply-chain exposure) minimal.

## Format rules

- First non-comment line must be the header `key,value`.
- Lines that start with `#` are **comments** and are ignored, so the template's
  instructions and section headers can stay in the file — you never have to
  delete them. (Only whole-line comments; a trailing `#` on a data row would be
  read as part of the value.)
- `format` must be `cloud-connector-estimator-inputs` and `formatVersion` `1`.
- Unknown keys are **rejected** (fail closed) rather than silently ignored, so a
  typo surfaces instead of quietly changing your quote.
- Booleans are `true` / `false`; numbers are non-negative.

## Field reference

### Cloud

| Key | Meaning |
| --- | --- |
| `provider` | `azure`, `aws`, or `gcp` |
| `region` | e.g. `eastus`, `us-east-1`, `us-central1` |

### Capabilities (`true` / `false`) — what to price

| Key | Capability |
| --- | --- |
| `capability.discovery` | Asset discovery (no billable meter of its own) |
| `capability.auditLogs` | Audit-log ingestion + storage |
| `capability.adsCloud` | Agentless disk scanning (cloud) |
| `capability.adsOutpost` | Agentless disk scanning (outpost scanner VM) |
| `capability.dspm` | Data security posture management (object scanning) |
| `capability.registry` | Container registry scanning |
| `capability.serverless` | Serverless/function scanning |
| `capability.egress` | Network egress from the audit stream |

At least one capability line is required. A capability that is `true` but whose
sizing fields are absent is refused (never quoted at $0 by accident); set the
field explicitly to `0` if it really is empty.

### Volume (whole numbers; `0` if not applicable)

| Key | Unit / meaning | Sizes |
| --- | --- | --- |
| `volume.accountCount` | Cloud accounts/subscriptions | audit, egress |
| `volume.monthlyActiveUsers` | MAU (optional elasticity input) | audit |
| `volume.ingressGBPerDay` | Audit ingress GB/day | audit stream |
| `volume.peakMBps` | Peak ingest MB/s | audit stream |
| `volume.peakEventsPerSec` | Peak events/s | audit stream |
| `volume.overrideStreamMetrics` | `true` to pin ingress/peak yourself; `false` to derive them from `accountCount` | — |
| `volume.dataEstateGB` | Data estate scanned by DSPM (GB) | dspm |
| `volume.pctScanned` | Percent of the estate scanned each cycle | dspm |
| `volume.scansPerMonth` | Scan cycles per month | dspm, ads, registry |
| `volume.vmCount` | VMs scanned | ads |
| `volume.avgUsedDiskGB` | Average used disk per VM (GB) | ads |
| `volume.imageCount` | Container images | registry |
| `volume.avgImageGB` | Average image size (GB) | registry (cross-region) |
| `volume.crossRegionPull` | `true` if registry pulls cross a region boundary (makes `avgImageGB` billable) | registry |
| `volume.packageCount` | Function packages | serverless |
| `volume.egressGB` | Explicit egress GB (when not derived from audit) | egress |

### Assumptions (sensible defaults; change only if you know why)

| Key | Meaning | Default |
| --- | --- | --- |
| `assumption.monthHours` | Hours per month for prorated meters | 730 |
| `assumption.assumedEventBytes` | Average event size for GB→events (Azure) | 1024 |
| `assumption.avgStoredGB` | Assumed stored GB for audit storage | 100 |
| `assumption.logIntensity` | `low` / `medium` / `high` | medium |

## What you get back

The tool prices every enabled capability against the vendor-verified rate ledger,
shows a per-meter breakdown with a **Source** link to the official price page,
splits the total by confidence band, and — if you upload a changed file over a
previous one — shows **what changed since your last estimate**. Confidence is
capped for any line whose rate is not vendor-backed (none are today).
