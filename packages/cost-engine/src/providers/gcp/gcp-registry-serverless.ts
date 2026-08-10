/**
 * GCP registry (Artifact Registry) + serverless (Cloud Run) scan estimators.
 * @see https://cloud.google.com/artifact-registry/pricing
 * @see https://cloud.google.com/run/pricing
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import {
  estimateRegistryScanForProvider,
  estimateServerlessScanForProvider,
} from "../registry-serverless/estimate-scan-core.ts";
import type {
  RegistryScanInputs,
  ScanEstimateResult,
  ServerlessScanInputs,
} from "../registry-serverless/scan.types.ts";

export const GCP_REGISTRY_METER = "artifact-registry-egress";
export const GCP_SERVERLESS_METER = "cloud-run-scan-ops";

/**
 * GCP Artifact Registry incremental scan-pull monthly cost.
 * `pullGb = imageCount × avgImageGB × scansPerMonth`; same-region pulls are
 * billed $0 (Artifact Registry does not charge network egress for same-region
 * access) and only `crossRegionPull=true` applies `pullGb × $/GB` network
 * egress. Never charges for existing registry storage — pull bandwidth only.
 *
 * @param inputs Registry scan volume/config. `enabled=false` → $0.
 * @param rates GCP RateCard; must carry `artifact-registry-egress`.
 * @returns Single pull-bandwidth line item (Low confidence).
 * @see https://cloud.google.com/artifact-registry/pricing
 */
export function estimateGcpRegistryScan(
  inputs: RegistryScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  return estimateRegistryScanForProvider(
    "gcp",
    { pullMeterId: GCP_REGISTRY_METER, providerLabel: "GCP" },
    inputs,
    rates,
  );
}

/**
 * GCP serverless (Cloud Run / Cloud Functions) incremental scan-ops monthly cost.
 * `ops = packageCount × scansPerMonth`; billed as `(ops / 1e6) × $/million-request`
 * against the `cloud-run-scan-ops` meter. Note: Cloud Run's real pricing is
 * primarily vCPU-second/GiB-second compute time (see capability-meter-map's
 * documented unit) plus a per-request component — this v1 formula only bills
 * the request-count proxy (`avgPackageGB` is tracked in notes, not billed) as
 * a Low-confidence approximation; it does not meter actual compute duration.
 * Never charges for existing function/package storage — incremental ops only.
 *
 * @param inputs Serverless scan volume/config. `enabled=false` → $0.
 * @param rates GCP RateCard; must carry `cloud-run-scan-ops`.
 * @returns Single scan-ops line item (Low confidence).
 * @see https://cloud.google.com/run/pricing
 */
export function estimateGcpServerlessScan(
  inputs: ServerlessScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  return estimateServerlessScanForProvider(
    "gcp",
    { opsMeterId: GCP_SERVERLESS_METER, providerLabel: "GCP" },
    inputs,
    rates,
  );
}
