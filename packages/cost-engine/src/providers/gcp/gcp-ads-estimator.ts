/**
 * GCP ADS estimator — Persistent Disk snapshots + optional GCE scanner.
 * @see https://cloud.google.com/compute/disks-image-pricing
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

export const GCP_ADS_SNAPSHOT_METER = "pd-snapshot-storage";
export const GCP_ADS_OUTPOST_METER = "gce-outpost-scanner";

export function estimateGcpAds(inputs: AdsInputs, rates: RateCard): AdsResult {
  return estimateAdsForProvider(
    "gcp",
    {
      snapshotMeterId: GCP_ADS_SNAPSHOT_METER,
      outpostMeterId: GCP_ADS_OUTPOST_METER,
      providerLabel: "GCP",
    },
    inputs,
    rates,
  );
}
