/**
 * Multi-cloud estimateDspm facade (package 09).
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import { estimateAzureDspm } from "../azure/azure-dspm-estimator.ts";
import { estimateAwsDspm } from "../aws/aws-dspm-estimator.ts";
import { estimateGcpDspm } from "../gcp/gcp-dspm-estimator.ts";
import type { DspmInputs, DspmResult } from "./dspm.types.ts";

/**
 * Route to the per-provider DSPM estimator (Azure/AWS/GCP); each wraps the
 * shared band formula in `estimate-dspm-core.ts` with its own meter ids.
 * @throws when `rates.provider` doesn't match `provider`.
 */
export function estimateDspm(
  provider: CloudProvider,
  inputs: DspmInputs,
  rates: RateCard,
): DspmResult {
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match requested '${provider}'`,
    );
  }
  switch (provider) {
    case "azure":
      return estimateAzureDspm(inputs, rates);
    case "aws":
      return estimateAwsDspm(inputs, rates);
    case "gcp":
      return estimateGcpDspm(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
