/**
 * GCP DSPM estimator — GCS data-read band + optional ephemeral GCE.
 * @see https://cloud.google.com/storage/pricing
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateDspmForProvider } from "../dspm/estimate-dspm-core.ts";
import type { DspmInputs, DspmResult } from "../dspm/dspm.types.ts";

export const GCP_DSPM_READ_METER = "gcs-class-b-10k";
/** Enumerating the estate: a dearer operation class than a read. */
export const GCP_DSPM_LIST_METER = "gcs-class-a-10k";
export const GCP_DSPM_EPHEMERAL_METER = "gce-outpost-scanner";

/**
 * GCP DSPM monthly cost band — Low confidence (never a single point quote).
 * `scannedGB = dataEstateGB × (pctScanned/100) × scansPerMonth`, billed
 * against a blended $/GB "data read" proxy (`gcs-data-read-band`) that
 * approximates Class A/B operations + data-retrieval costs GCS does not
 * expose as one SKU. Optional ephemeral connector compute reuses the
 * outpost-scanner Compute Engine hourly meter (`hoursPerScan × scansPerMonth × $/hour`).
 * GCP has no DSPM-specific Gov fail-closed rule (unlike Azure) — Gov/restricted
 * regions warn and still estimate at Low confidence.
 *
 * @param inputs DSPM estate/scan config. `enabled=false` → $0.
 * @param rates GCP RateCard; must carry `gcs-data-read-band` (and
 *   `gce-outpost-scanner` when `includeEphemeralInfra` is set).
 * @returns low/expected/high band (0.5×/1×/2× expected) — UI must show the
 *   Low confidence warning, never a bare point estimate.
 * @see https://cloud.google.com/storage/pricing
 */
export function estimateGcpDspm(
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  return estimateDspmForProvider(
    "gcp",
    {
      listMeterId: GCP_DSPM_LIST_METER,
      dataReadMeterId: GCP_DSPM_READ_METER,
      ephemeralMeterId: GCP_DSPM_EPHEMERAL_METER,
      providerLabel: "GCP",
      govCloudFailClosed: false,
    },
    inputs,
    rates,
  );
}
