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
 * ACR bandwidth (scan pull), $/GB. Same-region pulls modeled as $0 (Azure
 * recommends co-locating registry + compute); only `crossRegionPull` bills.
 */
export const AZURE_REGISTRY_METER = "acr-pull-bandwidth";
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
 * @param rates Azure RateCard — must carry provider "azure" and `acr-pull-bandwidth`.
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
