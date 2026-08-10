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

/**
 * Registry scanning is billed as network egress, not as a registry meter.
 *
 * Artifact Registry egress bills at standard Compute Engine network rates; same-region egress is free.
 *
 * The estimator previously used an invented per-GB "pull bandwidth" meter that
 * matches no vendor SKU. Pointing it at the real egress meter keeps the number
 * defensible and keeps same-region scanning at $0, which is what actually happens.
 *
 * @see https://cloud.google.com/vpc/network-pricing
 */
export const GCP_REGISTRY_METER = "gcp-egress-gb";
export const GCP_SERVERLESS_METER = "cloud-run-scan-ops";

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
