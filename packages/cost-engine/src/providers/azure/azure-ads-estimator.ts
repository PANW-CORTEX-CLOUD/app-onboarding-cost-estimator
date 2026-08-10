/**
 * Azure ADS estimator — Managed Disk snapshots + optional outpost scanner VM.
 *
 * Provider-meter wrapper around the shared `estimateAdsForProvider` (package 08,
 * `providers/ads/estimate-ads-core.ts`) — Azure supplies only its meter ids and
 * label; the snapshot proration / outpost compute-hours formulas live there.
 *
 * Snapshot billing basis verified against Azure docs: Managed Disk snapshots are
 * billed on **used** (occupied) size, not provisioned size, in $/GB-month — matches
 * `snapshotGbMonthsUsedSize`'s use of `avgUsedDiskGB` (never `avgProvisionedDiskGB`).
 * v1 also conservatively bills full snapshots (not incremental delta-only pricing),
 * which the shared core documents and warns on via `snapshotModel`.
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/managed-disks/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

/** Managed Disks Snapshots (used size), $/GB-month. */
export const AZURE_ADS_SNAPSHOT_METER = "managed-disk-snapshot";
/** Outpost scanner VM compute, $/hour (Cloud mode omits this line entirely). */
export const AZURE_ADS_OUTPOST_METER = "vm-outpost-scanner";

/**
 * @param inputs ADS toggle, mode (Cloud/Outpost), and volume signals.
 * @param rates Azure RateCard — must carry provider "azure"; requires
 *   `managed-disk-snapshot`, plus `vm-outpost-scanner` when `mode === "Outpost"`.
 * @returns Line items + totals; confidence "Med" (Cloud) / "Low" (Outpost) per
 *   the CLOUD_COST_MODEL.md confidence policy for ADS.
 */
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
