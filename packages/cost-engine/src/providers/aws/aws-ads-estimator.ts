/**
 * AWS ADS estimator — EBS snapshots + optional Outpost EC2 scanner.
 * @see https://aws.amazon.com/ebs/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

/** EBS snapshot storage, billed for the snapshot's **used** (not provisioned) size. */
export const AWS_ADS_SNAPSHOT_METER = "ebs-snapshot-storage";
/** EC2 on-demand compute for the Outpost-mode scanner instance, billed per hour. */
export const AWS_ADS_OUTPOST_METER = "ec2-outpost-scanner";

/**
 * ADS Cloud Scan (EBS snapshots) + optional ADS Outpost (EC2 scanner) estimate.
 *
 * Formula (shared across providers via `estimateAdsForProvider`, package 08):
 * - snapshotCost = vmCount × scansPerMonth × avgUsedDiskGB × `ebs-snapshot-storage`
 *   ($/GB-month) × (snapshotLifetimeHours / monthHours) — i.e. GB-months of
 *   snapshot storage prorated to the retention window, matching EBS's
 *   "billed for actual used size, for as long as the snapshot is retained" model.
 * - computeCost (Outpost mode only) = scansPerMonth × outpostHoursPerScan ×
 *   `ec2-outpost-scanner` ($/hour).
 *
 * @param inputs ADS inputs (`mode: "Cloud" | "Outpost"`); `enabled=false` → $0.
 * @param rates AWS RateCard — must carry provider "aws".
 * @returns Snapshot + (optional) compute line items, GB-months, and totals.
 * @see https://aws.amazon.com/ebs/pricing/ — snapshots billed by used size, GB-month.
 * @see https://aws.amazon.com/ec2/pricing/on-demand/ — Outpost scanner instance-hours.
 */
export function estimateAwsAds(inputs: AdsInputs, rates: RateCard): AdsResult {
  return estimateAdsForProvider(
    "aws",
    {
      snapshotMeterId: AWS_ADS_SNAPSHOT_METER,
      outpostMeterId: AWS_ADS_OUTPOST_METER,
      providerLabel: "AWS",
    },
    inputs,
    rates,
  );
}
