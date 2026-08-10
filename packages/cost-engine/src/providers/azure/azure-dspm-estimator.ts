/**
 * Azure DSPM estimator — blob data-read band + optional ephemeral connector compute.
 * Azure Government: fail closed (N/A per Cortex — no commercial-rate substitution).
 *
 * Provider-meter wrapper around the shared `estimateDspmForProvider` (package 09,
 * `providers/dspm/estimate-dspm-core.ts`) — the `scannedGB × $/GB` band formula and
 * the `{low, expected, high}` banding live there; Low confidence always (DSPM
 * scan volume is inherently estimated, never a metered actual).
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/storage/blobs/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { AZURE_TF_DEFAULTS } from "./capability-meter-map.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

/** Blob Storage read / data retrieval (band), $/GB. */
export const AZURE_DSPM_READ_METER = "blob-data-read-ops";
/** Reuses the outpost scanner VM meter for optional ephemeral connector compute. */
export const AZURE_DSPM_EPHEMERAL_METER = "vm-outpost-scanner";

/**
 * @param inputs DSPM toggle + data-estate volume signals.
 * @param rates Azure RateCard — must carry provider "azure"; requires
 *   `blob-data-read-ops`, plus `vm-outpost-scanner` when `includeEphemeralInfra`.
 * @returns `{low, expected, high}` band totals (never a bare point) — always Low confidence.
 * @throws when the region looks like Azure Government (DSPM is N/A per Cortex; fail
 *   closed instead of pricing at commercial rates).
 */
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
