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

export const AZURE_REGISTRY_METER = "acr-pull-bandwidth";
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
