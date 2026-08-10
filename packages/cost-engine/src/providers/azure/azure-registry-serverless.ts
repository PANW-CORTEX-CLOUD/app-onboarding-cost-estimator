/**
 * Azure registry (ACR) + serverless (Functions) scan estimators.
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
 * Azure Container Registry publishes no per-GB pull charge: the bill is the registry SKU plus storage (both pre-existing customer infrastructure, not caused by onboarding Cortex) and standard network egress. Same-region pulls incur no egress.
 *
 * The estimator previously used an invented per-GB "pull bandwidth" meter that
 * matches no vendor SKU. Pointing it at the real egress meter keeps the number
 * defensible and keeps same-region scanning at $0, which is what actually happens.
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/bandwidth/
 */
export const AZURE_REGISTRY_METER = "azure-egress-gb";
export const AZURE_SERVERLESS_METER = "functions-scan-ops";

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
