/**
 * Multi-cloud estimateAuditStorage facade (package 07).
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import { estimateAzureAuditStorage } from "../azure/azure-storage-estimator.ts";
import { estimateAwsAuditStorage } from "../aws/aws-storage-estimator.ts";
import { estimateGcpAuditStorage } from "../gcp/gcp-storage-estimator.ts";
import type {
  AuditStorageInputs,
  AuditStorageResult,
} from "./audit-storage.types.ts";

export function estimateAuditStorage(
  provider: CloudProvider,
  inputs: AuditStorageInputs,
  rates: RateCard,
): AuditStorageResult {
  if (rates.provider !== provider) {
    throw new Error(
      `RateCard provider '${rates.provider}' does not match requested '${provider}'`,
    );
  }
  switch (provider) {
    case "azure":
      return estimateAzureAuditStorage(inputs, rates);
    case "aws":
      return estimateAwsAuditStorage(inputs, rates);
    case "gcp":
      return estimateGcpAuditStorage(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
