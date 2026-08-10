# Official formula checks

Golden formula citations for cost-engine fixtures. Each row: formula → official URL → fixture test.

checkedAt: 2026-07-28

Refresh procedure: see [sources/README.md](./README.md) (package 14). Executable registry:
`packages/cost-engine/src/providers/formula-regression/registry.ts`.

## Package 06 — Audit streams

| Provider | Formula / binding | Official source | Fixture test |
|----------|-------------------|-----------------|--------------|
| Azure Event Hubs Standard | 1 TU ≈ 1 MB/s **or** ~1000 events/sec; min 1 TU when audit on; max auto-inflate 20 (TF) | https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability | `providers/streams/__tests__/audit-stream.test.ts` — Azure: 1 TU binding |
| Azure Event Hubs Standard | 84 GB events included per TU per month (brokered volume binding) | https://azure.microsoft.com/en-us/pricing/details/event-hubs/ | `AZURE_EH_INCLUDED_GB_PER_TU` + retention overage fixture |
| Azure Event Hubs | Capture **not** modeled when absent from TF (`captureConfigured=false`) | azure/data AUDIT_LOGS TF + pricing page Capture SKU | EDGE: Capture meter never emitted |
| Azure Event Hubs | Partitions ≠ Throughput Units (pricing unit is TU-hour) | https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability | EDGE: partition topology ignored for TU pricing |
| AWS Kinesis Data Streams | 1 shard ≈ 1 MB/s ingress / ~1000 records/sec; PUT Payload Unit = 25 KB | https://aws.amazon.com/kinesis/data-streams/pricing/ | `AWS Kinesis: shard sizing + PUT payload units` |
| AWS Kinesis | Min 1 shard when audit enabled (zero ingress) | https://aws.amazon.com/kinesis/data-streams/pricing/ | EDGE: zero ingress still bills minimum unit |
| GCP Pub/Sub | Message delivery GiB + message storage GiB-month | https://cloud.google.com/pubsub/pricing | `GCP Pub/Sub: delivery + storage line items` |
| GCP Pub/Sub | Audit on + zero ingress → minimum storage floor (fail closed ≠ $0) | https://cloud.google.com/pubsub/pricing | REQ: GCP enforce minimum capacity |

## Package 07 — Audit storage

| Provider | Formula / binding | Official source | Fixture test |
|----------|-------------------|-----------------|--------------|
| Azure Blob Hot LRS | capacityCost = avgGB × $/GB-month (`blob-hot-lrs-capacity`); TF Standard+LRS | https://azure.microsoft.com/en-us/pricing/details/storage/blobs/ | `providers/storage/__tests__/audit-storage.test.ts` — capacityCost |
| AWS S3 Standard | capacityCost = avgGB × $/GB-month (`s3-standard-storage`) | https://aws.amazon.com/s3/pricing/ | same — AWS S3 |
| GCP Cloud Storage Standard | capacityCost = avgGB × $/GB-month (`gcs-standard-storage`) | https://cloud.google.com/storage/pricing | same — GCP GCS |
| All | audit off → $0; floor 1 GB when audit on + avgGB unset | — | AC floor + TEST off→$0 |
| All | No lifecycle auto-delete assumed; GRS/ZRS/Multi-region fails closed | pricing + TF LRS/Standard | EDGE redundancy |

## Package 08 — ADS (Cloud / Outpost)

| Provider | Formula / binding | Official source | Fixture test |
|----------|-------------------|-----------------|--------------|
| Azure Managed Disks | snapshotCost = vmCount × scans × usedGB × rate × (lifetimeHours/730) | https://azure.microsoft.com/en-us/pricing/details/managed-disks/ | `providers/ads/__tests__/ads.test.ts` |
| AWS EBS snapshots | same used-size proration (`ebs-snapshot-storage`) | https://aws.amazon.com/ebs/pricing/ | same — AWS |
| GCP PD snapshots | same used-size proration (`pd-snapshot-storage`) | https://cloud.google.com/compute/disks-image-pricing | same — GCP |
| All | Cloud mode → snapshot only; Outpost → snapshot + scanner compute | — | AC Cloud vs Outpost |
| All | v1 full used size (incremental = warn, no discount); Gov region warn | — | EDGE |

## Package 09 — DSPM

| Provider | Formula / binding | Official source | Fixture test |
|----------|-------------------|-----------------|--------------|
| Azure Blob reads | expected = dataEstateGB × (pctScanned/100) × scans × rate; band ×0.5/×2.0 | https://azure.microsoft.com/en-us/pricing/details/storage/blobs/ | `providers/dspm/__tests__/dspm.test.ts` |
| AWS S3 retrieval | same band formula (`s3-data-retrieval-band`) | https://aws.amazon.com/s3/pricing/ | same |
| GCP GCS reads | same band formula (`gcs-data-read-band`) | https://cloud.google.com/storage/pricing | same |
| Azure Gov | DSPM N/A per Cortex — fail closed | docs/CLOUD_COST_MODEL.md Gov gaps | TEST Azure Gov fail closed |
| All | Low confidence band only; ephemeral uplift opt-in | — | AC + EDGE |

## Package 10 — Registry + serverless

| Provider | Formula / binding | Official source | Fixture test |
|----------|-------------------|-----------------|--------------|
| Azure ACR | cross-region: imageCount × avgGB × scans × pull rate; same-region $0 BW | https://azure.microsoft.com/en-us/pricing/details/container-registry/ | `providers/registry-serverless/__tests__/registry-serverless.test.ts` |
| AWS ECR | same pull model (`ecr-data-transfer`) | https://aws.amazon.com/ecr/pricing/ | same |
| GCP Artifact Registry | same pull model (`artifact-registry-egress`) | https://cloud.google.com/artifact-registry/pricing | same |
| Azure Functions / AWS Lambda / GCP Cloud Run | packageCount × scans / 1e6 × ops rate; no storage charge | Functions / Lambda / Run pricing pages | TEST serverless scale |
| All | Independent toggles; zero images/packages warn | — | AC + EDGE |

## Package 11 — Egress / cross-cloud bandwidth

| Provider | Formula / binding | Official source | Fixture test |
|----------|-------------------|-----------------|--------------|
| Azure Bandwidth | egressGB × zoneMultiplier × `azure-egress-gb`; audit default = stream ingress GB | https://azure.microsoft.com/en-us/pricing/details/bandwidth/ | `providers/egress/__tests__/egress.test.ts` |
| AWS Data Transfer | same model (`aws-egress-gb`) | https://aws.amazon.com/ec2/pricing/on-demand/ | same |
| GCP VPC egress | same model (`gcp-egress-gb`) | https://cloud.google.com/vpc/network-pricing | same |
| All | Toggle off → $0; unknown zone exclude+warn; Private Link reduces; never free cross-cloud | — | TEST + EDGE |

## Package 12 — Volume signals

| Signal / binding | Formula | Official / model source | Fixture test |
|------------------|---------|-------------------------|--------------|
| Account scale | `ingress/peak × (accountCount / 10)` | `docs/CLOUD_COST_MODEL.md` Volume elasticities | `core/__tests__/volume-signals.test.ts` |
| Log intensity | low 0.5 / medium 1 / high 2 | same | same |
| Log categories | Azure Entra 8, AWS CT+GD 2, GCP Audit 3 | Entra / CloudTrail / Cloud Audit docs | same (EDGE) |
| Raw paste | Overrides preset fields; invalid rejected | — | same |
| BYO managed stream | Zeros EH TU / Kinesis shard-hour / Pub/Sub storage | Stream pricing pages (namespace/capacity) | `providers/streams/__tests__/volume-signals.test.ts` |

## Package 13 — Rate pinning

| Binding | Formula / contract | Source | Fixture test |
|---------|-------------------|--------|--------------|
| Freeze export | Pin `rateCard.unitPrices` + `modelVersion` + `ratesAsOf` + `inputHash` | `core/rate-pinning.ts` / `docs/COST_MODEL_CHANGELOG.md` | `core/__tests__/rate-pinning.test.ts` |
| Reproduce | Re-estimate with pinned card → totals within $0.01 | — | same + `providers/streams/__tests__/rate-pinning.test.ts` |
| Stale pin | ageDays > 180 → warn | — | EDGE |
| Version bump | mismatch → `model_version_mismatch` (graceful) | — | EDGE |

## Package 14 — Official formula regression pack

| Check | Contract | Official source | Fixture |
|-------|----------|-----------------|---------|
| Azure EH TU capacity binding | 1 MB/s or 1000 eps → 1 TU; golden stream/storage/ADS | https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability | `providers/azure/__tests__/formula-regression.test.ts` + `fixtures/azure-golden.json` |
| Azure Blob / snapshot | capacityCost + used-size proration | https://azure.microsoft.com/en-us/pricing/details/storage/blobs/ · https://azure.microsoft.com/en-us/pricing/details/managed-disks/ | same |
| AWS Kinesis / S3 / EBS | shard binding + capacity + proration | https://aws.amazon.com/kinesis/data-streams/pricing/ · https://aws.amazon.com/s3/pricing/ · https://aws.amazon.com/ebs/pricing/ | `providers/aws/__tests__/formula-regression.test.ts` |
| GCP Pub/Sub / GCS / PD | delivery+storage + capacity + proration | https://cloud.google.com/pubsub/pricing · https://cloud.google.com/storage/pricing · https://cloud.google.com/compute/disks-image-pricing | `providers/gcp/__tests__/formula-regression.test.ts` |
| Catalog / drift EDGE | Registry ↔ this doc; live drift >30% warn (never auto-pass); no `SKIP_FORMULA_CHECKS` bypass | — | `providers/formula-regression/__tests__/catalog.test.ts` |
| Optional live smoke | `LIVE_PRICE_SMOKE=1` probes official host; unset = explicit opt-out (not silent skip) | — | same |

## Later packages

Rows for OpenAPI / UI (15+) land with those packages.
