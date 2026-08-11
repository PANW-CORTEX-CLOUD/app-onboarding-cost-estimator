/**
 * GCP ADS estimator — Persistent Disk snapshots + optional GCE scanner.
 * @see https://cloud.google.com/compute/disks-image-pricing
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

/**
 * PD/Hyperdisk snapshot storage is a SINGLE flat $/GB-month rate on the total
 * snapshot size — it does NOT vary by source disk type (pd-standard /
 * pd-balanced / pd-ssd). Verified 2026-08-11 against
 * docs.cloud.google.com/compute/docs/disks/snapshots: "charge only for the
 * total size of the snapshot". An earlier plan proposed a `sourceDiskType`
 * input on the belief that snapshots are "priced as the underlying disk";
 * that belief is refuted, so a single meter is the correct shape — do not
 * reintroduce a per-disk-type split.
 *
 * The value (0.05/GB-month us-central1 regional) is the current standard-
 * snapshot rate after GCP's 2023-04-01 increase from 0.026, but is held as
 * `unverified` in the ledger (Low confidence + warning on every estimate)
 * because the official price table is client-rendered and cannot be
 * machine-confirmed. See sources/price-validations.json → pd-snapshot-storage.
 */
export const GCP_ADS_SNAPSHOT_METER = "pd-snapshot-storage";
/**
 * Ephemeral scanner VM. Machine type: **e2-standard-2** (2 vCPU / 8 GiB) —
 * the GCP analogue of Azure D2s v3 (2 vCPU / 8 GB); AWS t3.medium is smaller
 * (2 vCPU / 4 GB). Priced at the **on-demand** us-central1 list rate
 * ($0.067/hr as of 2026-08-11), NOT the sustained-use rate: the scanner runs
 * only `outpostHoursPerScan` per scan (see `estimateAdsForProvider`
 * `computeCost = rate × scansPerMonth × hoursPerScan`), far below the
 * sustained-use threshold, so a discounted rate would understate it. Held
 * `unverified` in the ledger (Low confidence + warning) because the figure is
 * from secondary sources, not a machine-readable official feed. See
 * sources/price-validations.json → gce-outpost-scanner.
 */
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
