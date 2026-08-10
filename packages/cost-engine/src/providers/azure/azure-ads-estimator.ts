/**
 * Azure ADS estimator — Managed Disk snapshots + optional outpost scanner VM.
 * @see https://azure.microsoft.com/en-us/pricing/details/managed-disks/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

export const AZURE_ADS_SNAPSHOT_METER = "managed-disk-snapshot";
export const AZURE_ADS_OUTPOST_METER = "vm-outpost-scanner";

export function estimateAzureAds(
  inputs: AdsInputs,
  rates: RateCard,
): AdsResult {
  return estimateAdsForProvider(
    "azure",
    {
      snapshotMeterId: AZURE_ADS_SNAPSHOT_METER,
      outpostMeterId: AZURE_ADS_OUTPOST_METER,
      providerLabel: "Azure",
    },
    inputs,
    rates,
  );
}
