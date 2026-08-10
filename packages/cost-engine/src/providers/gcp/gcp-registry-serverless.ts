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
