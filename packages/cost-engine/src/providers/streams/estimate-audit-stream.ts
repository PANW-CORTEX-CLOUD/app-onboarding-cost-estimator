/**
 * Multi-cloud audit stream facade (package 06).
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import { estimateAzureAuditStream } from "../azure/azure-stream-estimator.ts";
import { estimateAwsAuditStream } from "../aws/aws-stream-estimator.ts";
import { estimateGcpAuditStream } from "../gcp/gcp-stream-estimator.ts";
import type {
  AuditStreamInputs,
  AuditStreamResult,
} from "./audit-stream.types.ts";

export function estimateAuditStream(
  provider: CloudProvider,
  inputs: AuditStreamInputs,
  rates: RateCard,
): AuditStreamResult {
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match requested '${provider}'`,
    );
  }
  switch (provider) {
    case "azure":
      return estimateAzureAuditStream(inputs, rates);
    case "aws":
      return estimateAwsAuditStream(inputs, rates);
    case "gcp":
      return estimateGcpAuditStream(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
