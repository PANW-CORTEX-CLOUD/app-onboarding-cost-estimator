/**
 * Multi-cloud estimateEgress facade (package 11).
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import { estimateAzureEgress } from "../azure/azure-egress-estimator.ts";
import { estimateAwsEgress } from "../aws/aws-egress-estimator.ts";
import { estimateGcpEgress } from "../gcp/gcp-egress-estimator.ts";
import type { EgressInputs, EgressResult } from "./egress.types.ts";

export function estimateEgress(
  provider: CloudProvider,
  inputs: EgressInputs,
  rates: RateCard,
): EgressResult {
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match requested '${provider}'`,
    );
  }
  switch (provider) {
    case "azure":
      return estimateAzureEgress(inputs, rates);
    case "aws":
      return estimateAwsEgress(inputs, rates);
    case "gcp":
      return estimateGcpEgress(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
