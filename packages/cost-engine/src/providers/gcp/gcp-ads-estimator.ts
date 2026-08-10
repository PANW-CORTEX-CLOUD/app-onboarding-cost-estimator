/**
 * GCP ADS estimator — Persistent Disk snapshots + optional GCE scanner.
 * @see https://cloud.google.com/compute/disks-image-pricing
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

export const GCP_ADS_SNAPSHOT_METER = "pd-snapshot-storage";
export const GCP_ADS_OUTPOST_METER = "gce-outpost-scanner";

/**
 * GCP ADS (Agentless Disk Scanning) monthly cost — Persistent Disk snapshots
 * (+ optional Compute Engine outpost scanner). Formula shared across
 * providers via `estimateAdsForProvider`:
 * `snapshotCost = vmCount × avgUsedDiskGB × scansPerMonth × $/GB-month ×
 * (snapshotLifetimeHours / monthHours)`.
 *
 * PD snapshots bill **used data size, not provisioned size**, in decimal GB
 * (no GiB conversion). v1 conservatively bills full used size per scan; real
 * GCP billing after the first snapshot only charges for changed blocks
 * (incremental) — this engine intentionally does not model that discount
 * (documented in the shared ADS core notes/warnings, not a GCP-specific gap).
 * Outpost scanner compute is a separate hourly Compute Engine VM line
 * (`gce-outpost-scanner`), independent of snapshot billing.
 *
 * @param inputs ADS mode/volume config. `enabled=false` → $0.
 * @param rates GCP RateCard; must carry `pd-snapshot-storage` (and
 *   `gce-outpost-scanner` when mode is "Outpost").
 * @returns snapshotCost + optional computeCost line items.
 * @see https://cloud.google.com/compute/disks-image-pricing
 * @see https://cloud.google.com/compute/vm-instance-pricing
 */
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
