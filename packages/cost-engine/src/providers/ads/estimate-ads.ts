/**
 * Multi-cloud estimateAds facade (package 08).
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import { estimateAzureAds } from "../azure/azure-ads-estimator.ts";
import { estimateAwsAds } from "../aws/aws-ads-estimator.ts";
import { estimateGcpAds } from "../gcp/gcp-ads-estimator.ts";
import type { AdsInputs, AdsResult } from "./ads.types.ts";

export function estimateAds(
  provider: CloudProvider,
  inputs: AdsInputs,
  rates: RateCard,
): AdsResult {
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match requested '${provider}'`,
    );
  }
  switch (provider) {
    case "azure":
      return estimateAzureAds(inputs, rates);
    case "aws":
      return estimateAwsAds(inputs, rates);
    case "gcp":
      return estimateGcpAds(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
