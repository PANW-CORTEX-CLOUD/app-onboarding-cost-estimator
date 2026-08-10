/**
 * Azure DSPM estimator — blob data-read band + optional ephemeral connector compute.
 * Azure Government: fail closed (N/A per Cortex).
 * @see https://azure.microsoft.com/en-us/pricing/details/storage/blobs/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { AZURE_TF_DEFAULTS } from "./capability-meter-map.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

export const AZURE_DSPM_READ_METER = "blob-data-read-ops";
export const AZURE_DSPM_EPHEMERAL_METER = "vm-outpost-scanner";

export function estimateAzureDspm(
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  const withDiscovery: DspmInputs = {
    ...inputs,
    discoveryTelemetryEmpty:
      inputs.discoveryTelemetryEmpty ?? AZURE_TF_DEFAULTS.discoveryTfEmpty,
  };
  return estimateDspmForProvider(
    "azure",
    {
      dataReadMeterId: AZURE_DSPM_READ_METER,
      ephemeralMeterId: AZURE_DSPM_EPHEMERAL_METER,
      providerLabel: "Azure",
      govCloudFailClosed: true,
    },
    withDiscovery,
    rates,
  );
}
