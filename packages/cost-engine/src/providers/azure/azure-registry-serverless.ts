/**
 * Azure registry (ACR) + serverless (Functions) scan estimators.
 *
 * Provider-meter wrappers around the shared `estimate-scan-core.ts` (package 10)
 * formulas; Azure supplies only meter ids/label. Both are Low confidence,
 * modeled capabilities with no connector TF (see tf-audit-reconciliation.ts).
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/container-registry/
 * @see https://azure.microsoft.com/en-us/pricing/details/functions/
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
 * Azure Container Registry publishes no per-GB pull charge: the bill is the
 * registry SKU plus storage (both pre-existing customer infrastructure, not
 * caused by onboarding Cortex) and standard network egress. Same-region
 * pulls incur no egress.
 *
 * The estimator previously used an invented per-GB "pull bandwidth" meter
 * that matched no vendor SKU (`acr-pull-bandwidth`). Pointing it at the real
 * egress meter keeps the number defensible and keeps same-region scanning
 * at $0, which is what actually happens.
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/bandwidth/
 */
export const AZURE_REGISTRY_METER = "azure-egress-gb";
/**
 * Azure Functions incremental scan ops, $/million-executions. NOTE: the Functions
 * Consumption plan bills executions AND GB-seconds (execution time × memory) as
 * two separate official meters — this single meter only prices the execution-count
 * dimension; `avgPackageGB` volume is tracked in `notes` but not billed (see
 * estimate-scan-core.ts `estimateServerlessScanForProvider`, out of azure/ scope).
 */
export const AZURE_SERVERLESS_METER = "functions-scan-ops";

/**
 * @param inputs Registry scan toggle, image volume, and `crossRegionPull` flag.
 * @param rates Azure RateCard — must carry provider "azure" and `azure-egress-gb`.
 * @returns $0 line item for same-region pulls; `pullGB × rate` for cross-region.
 * @see https://azure.microsoft.com/en-us/pricing/details/container-registry/
 */
export function estimateAzureRegistryScan(
  inputs: RegistryScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  return estimateRegistryScanForProvider(
    "azure",
    { pullMeterId: AZURE_REGISTRY_METER, providerLabel: "Azure" },
    inputs,
    rates,
  );
}

/**
 * @param inputs Serverless scan toggle, package volume, and scan cadence.
 * @param rates Azure RateCard — must carry provider "azure" and `functions-scan-ops`.
 * @returns `(ops / 1_000_000) × rate` — execution-count dimension only (see
 *   `AZURE_SERVERLESS_METER` doc for the untracked GB-second dimension).
 * @see https://azure.microsoft.com/en-us/pricing/details/functions/
 */
export function estimateAzureServerlessScan(
  inputs: ServerlessScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  return estimateServerlessScanForProvider(
    "azure",
    { opsMeterId: AZURE_SERVERLESS_METER, providerLabel: "Azure" },
    inputs,
    rates,
  );
}
