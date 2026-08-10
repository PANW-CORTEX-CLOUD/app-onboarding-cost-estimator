# Cloud cost model (Cortex customer infrastructure)

**Package:** `01/23` research SSOT  
**Scope:** Customer cloud infrastructure TCO for Palo Alto Cortex Cloud capabilities across **Azure, AWS, and GCP**. Cortex SaaS license lines are **out of scope** (non-cost).

Executable meter rows live in:

- `packages/cost-engine/src/providers/azure/capability-meter-map.ts`
- `packages/cost-engine/src/providers/aws/capability-meter-map.ts`
- `packages/cost-engine/src/providers/gcp/capability-meter-map.ts`

Doc tables below must match those exports **1:1** (enforced by snapshot tests).

**TF ↔ retail audit matrix (Azure SSOT):** [`TF_COST_RECONCILIATION.md`](./TF_COST_RECONCILIATION.md) — only audit Event Hubs + blob LRS bill customer cloud in connector TF; other capabilities are modeled.

---

## Customer TCO use cases

| Use case | Who | Outcome |
| --- | --- | --- |
| Pre-onboarding quote | SE / customer cloud owner | Monthly expected infra $ by provider + capability |
| Capability toggle what-if | Security architect | Isolate Audit / ADS / DSPM / Registry / Serverless cost |
| Multi-cloud compare | Platform team | Same volume signals across Azure vs AWS vs GCP |
| Reproducible export | Compliance / procurement | Frozen rates + modelVersion (`core/rate-pinning.ts`, `docs/COST_MODEL_CHANGELOG.md`) |

Bill only **customer-cloud meters** (streams, storage, snapshots, scanner compute, scan pull bandwidth). Do **not** add Cortex product SKUs.

---

## TF inventories

| Provider | Path | Status | Notes |
| --- | --- | --- | --- |
| Azure | `azure/data/` | **SSOT (real)** | Do not mutate TF for the estimator |
| AWS | `aws/` | **Stub** | README only — no connector IaC yet |
| GCP | `gcp/` | **Stub** | README only — no connector IaC yet |

### Azure TF defaults (from inventory)

| Setting | Value | Source file |
| --- | --- | --- |
| Event Hubs SKU | `Standard` | `azure/data/AUDIT_LOGS-audit_organization.tf` |
| EH capacity (TU) | `1` (auto-inflate max `20`) | same |
| EH partitions | `20` | same |
| EH retention | `7` days | same |
| Audit storage | Standard **LRS** | `azure/data/AUDIT_LOGS-audit_common_resources.tf` |
| Discovery TF | **Empty (0 bytes)** | `azure/data/DISCOVERY-assets_discovery.tf` |
| Event Hubs Capture | **Not configured** | — → no Capture meter |

### AWS / GCP modeling defaults (no TF yet)

| Provider | Default stream | Default audit store | Default region |
| --- | --- | --- | --- |
| AWS | **Kinesis** Data Streams (SQS alternate / BYO) | S3 Standard | `us-east-1` |
| GCP | **Pub/Sub** | Cloud Storage Standard | `us-central1` |

---

## Non-costs (explicitly excluded)

- Cortex Cloud / XSIAM / CSPM **SaaS license** line items
- Identity objects alone (UAMI, federated credentials, Entra app registrations) — no direct meter
- Custom RBAC role *definitions* and Graph app role JSON — permission signals only
- Azure Policy template deployment overhead (negligible / not modeled in v1)
- Unofficial blogs, third-party cost calculators — **reference-only**, never SSOT

---

## Official pricing & rates APIs (2026 citations)

| Provider | Primary product pages | Rates API |
| --- | --- | --- |
| Azure | [Event Hubs](https://azure.microsoft.com/en-us/pricing/details/event-hubs/), [Blob](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/), [Managed Disks](https://azure.microsoft.com/en-us/pricing/details/managed-disks/), [VMs](https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/), [ACR](https://azure.microsoft.com/en-us/pricing/details/container-registry/), [Functions](https://azure.microsoft.com/en-us/pricing/details/functions/) | [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices) |
| AWS | [Kinesis](https://aws.amazon.com/kinesis/data-streams/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [EBS](https://aws.amazon.com/ebs/pricing/), [EC2](https://aws.amazon.com/ec2/pricing/on-demand/), [ECR](https://aws.amazon.com/ecr/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/) | [Price List / price changes](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html) |
| GCP | [Pub/Sub](https://cloud.google.com/pubsub/pricing), [GCS](https://cloud.google.com/storage/pricing), [PD snapshots](https://cloud.google.com/compute/disks-image-pricing), [GCE](https://cloud.google.com/compute/vm-instance-pricing), [Artifact Registry](https://cloud.google.com/artifact-registry/pricing), [Cloud Run](https://cloud.google.com/run/pricing) | [Cloud Billing Catalog API](https://cloud.google.com/billing/docs/how-to/get-pricing-information-api) |

---

## Azure capability → permission → meter

| capability | permissionSignal | meterId | meterSku | unit | confidence | sourceUrl |
| --- | --- | --- | --- | --- | --- | --- |
| discovery | Custom cortex-reader / Reader-style inventory roles (main.tf) | none | n/a (permission-only) | n/a | High | https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles |
| audit_logs | Azure Event Hubs Data Receiver + diagnostic settings → Event Hub | eh-standard-tu | Event Hubs Standard Throughput Unit | TU-hour | High | https://azure.microsoft.com/en-us/pricing/details/event-hubs/ |
| audit_logs | Same as audit stream (EH ingress) | eh-standard-ingress-events | Event Hubs Standard Ingress Events | million-events | High | https://azure.microsoft.com/en-us/pricing/details/event-hubs/ |
| audit_logs | Storage Blob Data Contributor on audit storage account | blob-hot-lrs-capacity | Blob Storage Standard LRS capacity | GB-month | High | https://azure.microsoft.com/en-us/pricing/details/storage/blobs/ |
| ads_cloud | Disk snapshot / read permissions for Cloud Scan | managed-disk-snapshot | Managed Disks Snapshots (used size) | GB-month | Med | https://azure.microsoft.com/en-us/pricing/details/managed-disks/ |
| ads_outpost | Compute + disk access for outpost scanner VM | vm-outpost-scanner | Virtual Machines (outpost scanner SKU) | hour | Med | https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/ |
| dspm | Data-plane read on blob estates + connector ephemeral infra | blob-data-read-ops | Blob Storage read / data retrieval (band) | GB + 10k-ops | Low | https://azure.microsoft.com/en-us/pricing/details/storage/blobs/ |
| registry | ACR pull for incremental image scan | acr-pull-bandwidth | Container Registry / bandwidth (scan pull) | GB | Low | https://azure.microsoft.com/en-us/pricing/details/container-registry/ |
| serverless | Function App list/read for package scan | functions-scan-ops | Azure Functions (incremental scan ops / bandwidth) | GB + million-exec | Low | https://azure.microsoft.com/en-us/pricing/details/functions/ |

---

## AWS capability → permission → meter

| capability | permissionSignal | meterId | meterSku | unit | confidence | sourceUrl |
| --- | --- | --- | --- | --- | --- | --- |
| discovery | IAM ReadOnlyAccess-style inventory roles | none | n/a (permission-only) | n/a | High | https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_job-functions.html |
| audit_logs | CloudTrail / security findings → Kinesis stream | kinesis-shard-hour | Kinesis Data Streams shard-hour | shard-hour | High | https://aws.amazon.com/kinesis/data-streams/pricing/ |
| audit_logs | Same as audit stream | kinesis-put-payload-units | Kinesis PUT Payload Units | million-payload-units | High | https://aws.amazon.com/kinesis/data-streams/pricing/ |
| audit_logs | s3:PutObject / GetObject on audit bucket | s3-standard-storage | S3 Standard storage | GB-month | High | https://aws.amazon.com/s3/pricing/ |
| ads_cloud | ec2:CreateSnapshot / DescribeVolumes for Cloud Scan | ebs-snapshot-storage | EBS Snapshots (used size) | GB-month | Med | https://aws.amazon.com/ebs/pricing/ |
| ads_outpost | EC2 run for outpost scanner | ec2-outpost-scanner | Amazon EC2 (outpost scanner) | hour | Med | https://aws.amazon.com/ec2/pricing/on-demand/ |
| dspm | S3 data-plane reads + connector ephemeral infra | s3-data-retrieval-band | S3 data retrieval / GET requests (band) | GB + 1k-requests | Low | https://aws.amazon.com/s3/pricing/ |
| registry | ECR pull for incremental image scan | ecr-data-transfer | ECR data transfer (scan pull) | GB | Low | https://aws.amazon.com/ecr/pricing/ |
| serverless | lambda:ListFunctions / GetFunction for package scan | lambda-scan-ops | AWS Lambda (incremental scan) | GB-second + requests | Low | https://aws.amazon.com/lambda/pricing/ |

---

## GCP capability → permission → meter

| capability | permissionSignal | meterId | meterSku | unit | confidence | sourceUrl |
| --- | --- | --- | --- | --- | --- | --- |
| discovery | IAM roles/viewer (or Cortex reader equivalent) | none | n/a (permission-only) | n/a | High | https://cloud.google.com/iam/docs/understanding-roles |
| audit_logs | Cloud Audit Logs → Pub/Sub topic | pubsub-message-delivery | Pub/Sub message delivery / throughput | GiB | High | https://cloud.google.com/pubsub/pricing |
| audit_logs | Same as audit stream | pubsub-storage | Pub/Sub message storage | GiB-month | High | https://cloud.google.com/pubsub/pricing |
| audit_logs | storage.objects.create on audit bucket | gcs-standard-storage | Cloud Storage Standard | GB-month | High | https://cloud.google.com/storage/pricing |
| ads_cloud | compute.snapshots.create for Cloud Scan | pd-snapshot-storage | Persistent Disk snapshots (used size) | GB-month | Med | https://cloud.google.com/compute/disks-image-pricing |
| ads_outpost | compute.instances.create for outpost scanner | gce-outpost-scanner | Compute Engine VM (outpost scanner) | hour | Med | https://cloud.google.com/compute/vm-instance-pricing |
| dspm | GCS data reads + connector ephemeral infra | gcs-data-read-band | Cloud Storage Class A/B ops + data (band) | GB + 10k-ops | Low | https://cloud.google.com/storage/pricing |
| registry | Artifact Registry pull for incremental scan | artifact-registry-egress | Artifact Registry network egress (scan pull) | GB | Low | https://cloud.google.com/artifact-registry/pricing |
| serverless | Cloud Run / Cloud Functions list+read for package scan | cloud-run-scan-ops | Cloud Run / Cloud Functions (incremental scan) | vCPU-second + GiB-second | Low | https://cloud.google.com/run/pricing |

---

## Volume elasticities (package 12)

Account / subscription / project counts scale audit ingress and peak via elasticities. Raw metric paste overrides presets. BYO Event Hub / Kinesis / Pub/Sub zeros managed stream capacity lines.

| Signal | Effect |
| --- | --- |
| `accountCount` | Linear scale vs reference **10** accounts (`accountScale = accountCount / 10`) |
| `logIntensity` | low 0.5 / medium 1 / high 2 |
| Log categories | Azure Entra **8**, AWS CloudTrail+GuardDuty **2**, GCP Audit Logs **3** — multiplier = enabled/max |
| `monthlyActiveUsers` | +10% ingress per 10k MAU (capped +100%) |
| `rawMetrics` | Overrides computed ingress/peak fields (JSON or `key=value`) |
| `byoManagedStream` | Zeros managed TU / shard-hour / Pub/Sub storage capacity lines |

Executable SSOT: `packages/cost-engine/src/core/volume-signals.ts`.

---

## EDGE gaps & constraints

| Gap | Handling |
| --- | --- |
| Empty Discovery TF (`azure/data/DISCOVERY-assets_discovery.tf`) | Discovery = **$0**; no invented meters |
| Missing AWS/GCP TF | Stub paths `aws/`, `gcp/`; defaults documented above; no silent cross-provider copy from Azure |
| Missing telemetry defaults | Presets later (pkg 12); refuse false precision for Low-confidence bands |
| **Azure Government** | Separate SKUs / Retail Prices; DSPM may be N/A — fail closed / warn (do not use commercial eastus rates) |
| **AWS GovCloud** | Separate price list partition; do not mix with commercial `us-east-1` |
| **GCP FedRAMP / assurable** | Region + catalog restrictions; do not assume commercial `us-central1` rates |
| Unofficial blogs | Reference-only — never meter SSOT |
| Azure-only facts | Must **not** leak into `packages/cost-engine/src/core` types (maps stay under `providers/`) |
| Event Hubs Capture | Not in TF → **no** Capture meter in v1 |

---

## Confidence policy

| Capability family | Confidence | UI rule |
| --- | --- | --- |
| Discovery, Audit streams (+ primary store) | High | Point estimate OK |
| ADS Cloud / Outpost | Med | Show Med label |
| DSPM, Registry, Serverless | Low | low/expected/high band only — never false-precise single point |
