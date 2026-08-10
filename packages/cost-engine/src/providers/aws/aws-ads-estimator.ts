/**
 * AWS ADS estimator — EBS snapshots + optional Outpost EC2 scanner.
 * @see https://aws.amazon.com/ebs/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateAdsForProvider } from "../ads/estimate-ads-core.ts";
import type { AdsInputs, AdsResult } from "../ads/ads.types.ts";

export const AWS_ADS_SNAPSHOT_METER = "ebs-snapshot-storage";
export const AWS_ADS_OUTPOST_METER = "ec2-outpost-scanner";

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
