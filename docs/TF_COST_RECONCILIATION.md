# TF ↔ meter ↔ retail reconciliation (Azure audit SSOT)

**Package:** `30–33` (TF vs retail audit)  
**Executable allowlist:** `packages/cost-engine/src/providers/azure/tf-audit-reconciliation.ts`  
**Derived manifest:** [`sources/tf-feature-manifest.json`](../sources/tf-feature-manifest.json) — produced by `scripts/derive-tf-manifest.mjs` walking `azure/data`. A test asserts the derived meters equal the allowlist above, so the two derivations cannot drift.  
**Modes:** `tfMode: as-deployed` prices only deployed modules (comparable to a first invoice); `what-if` also prices capabilities with no connector TF.  
**Related:** [`CLOUD_COST_MODEL.md`](./CLOUD_COST_MODEL.md), [`COST_MODEL_CHANGELOG.md`](./COST_MODEL_CHANGELOG.md)

Azure [`azure/data/`](../azure/data/) is the **only** connector IaC SSOT. AWS/GCP paths are README stubs — estimates there are **modeled defaults**, not TF-grounded.

## Verdict

| Scope | Customer-cloud $ |
| --- | --- |
| Discovery only | **$0** (`DISCOVERY-assets_discovery.tf` is 0 bytes) |
| Audit logs (Event Hubs Standard + blob LRS) | **Yes — only billable connector infra in TF** |
| Identity / RBAC / policy / diagnostics config | Non-cost / excluded |
| ADS / DSPM / registry / serverless / egress | **No deployable TF** — estimator prices as **modeled · no connector TF** |

## Azure TF resource → priced? → meterId → retail source

| TF resource / artifact | Priced? | meterId | Official URL | Notes |
| --- | --- | --- | --- | --- |
| `DISCOVERY-assets_discovery.tf` (empty) | No → **$0** | `none` | [RBAC built-in roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles) | Permission-only |
| `azurerm_eventhub_namespace` (SKU Standard, capacity 1, auto-inflate max 20) | **Yes** | `eh-standard-tu` | [Event Hubs pricing](https://azure.microsoft.com/en-us/pricing/details/event-hubs/) | TU-hour; min 1 TU when audit on |
| Same namespace (ingress events) | **Yes** | `eh-standard-ingress-events` | [Event Hubs pricing](https://azure.microsoft.com/en-us/pricing/details/event-hubs/) | $/million events |
| `azurerm_storage_account` Standard LRS | **Yes** | `blob-hot-lrs-capacity` | [Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/) | Hot LRS GB-month; floor 1 GB when unset |
| `azurerm_eventhub` `partition_count` | **No** | — | — | Topology only; not a retail meter |
| Event Hubs **Capture** | **No** | — | — | **Not configured** in TF → Capture meter forbidden |
| `azurerm_user_assigned_identity` / RBAC assignments | **No** | — | — | Identity-only |
| `azurerm_eventhub_namespace_authorization_rule` | **No** | — | — | Auth config; no meter |
| `azurerm_eventhub_consumer_group` | **No** | — | — | Consumer group; no meter |
| `azurerm_resource_group` | **No** | — | — | Container; no meter |
| Management-group diagnostic settings (`azapi_resource`) | **No** | — | — | Routing config; cost is EH+blob |
| Policy / role definition JSON | **No** | — | — | Permission signals only |

### Audit-only billable allowlist (High confidence)

Exactly these three meters when Azure · audit-only (ops meters only if write/read ops > 0):

1. `eh-standard-tu`
2. `eh-standard-ingress-events`
3. `blob-hot-lrs-capacity`

Optional (not TF-invented; only when ops inputs > 0): `blob-hot-lrs-write-10k`, `blob-hot-lrs-read-10k`.

## Retail rate check (eastus, Consumption) — 2026-08-10

Re-verified live against the Azure Retail Prices API by `scripts/validate-prices.mjs`;
per-meter results in [`sources/price-validations.json`](../sources/price-validations.json).

Live Azure Retail Prices API vs in-repo [`fallback-prices.json`](../packages/cost-engine/src/providers/azure/fallback-prices.json):

| meterId | Live unitPrice | Fallback | Match |
| --- | --- | --- | --- |
| `eh-standard-tu` | $0.03 / hour | $0.03 | Yes |
| `eh-standard-ingress-events` | $0.028 / 1M | $0.028 | Yes |
| `blob-hot-lrs-capacity` | $0.0208 / GB-mo (list Hot LRS) | $0.0208 | Yes |
| `blob-hot-lrs-write-10k` | $0.05 / 10K | $0.05 | Yes — corrected from 0.055 on 2026-08-10 |
| `blob-hot-lrs-read-10k` | $0.004 / 10K | $0.004 | Yes |

Capture retail exists (`Standard Capture` ~$0.10/hr) but **must not** appear in estimates (TF has no Capture).

Empty live `Items` → fallback with explicit warning (`azure retail empty Items; using fallback`) — never silent $0.

## Formula bindings (unchanged)

- 1 TU ≈ 1 MB/s **or** 1000 events/s; 84 GB/TU included ingress allowance
- Partitions ignored for pricing
- TF golden defaults: 1 TU, 7d retention, Standard LRS
- Audit volume preset peaks (1 MB/s + 1000 eps) → **1 TU** (matches TF `capacity = 1`)

## Modeled capabilities (no Azure connector TF)

`ads_cloud`, `ads_outpost`, `dspm`, `registry`, `serverless`, `egress` — priced for comprehensive what-if only; labeled **modeled · no connector TF** in API warnings + UI.

## AWS / GCP

No connector TF inventory. Estimates use documented modeled defaults (Kinesis/S3, Pub/Sub/GCS). Single honesty warning: **no TF inventory — modeled defaults** (not per-toggle spam).
