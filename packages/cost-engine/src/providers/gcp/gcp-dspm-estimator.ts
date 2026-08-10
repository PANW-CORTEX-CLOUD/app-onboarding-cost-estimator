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
