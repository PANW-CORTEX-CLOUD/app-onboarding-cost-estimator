/**
 * Multi-cloud registry + serverless facades (package 10).
 * Independent toggles: call registry and serverless estimators separately.
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import {
  estimateAzureRegistryScan,
  estimateAzureServerlessScan,
} from "../azure/azure-registry-serverless.ts";
import {
  estimateAwsRegistryScan,
  estimateAwsServerlessScan,
} from "../aws/aws-registry-serverless.ts";
import {
  estimateGcpRegistryScan,
  estimateGcpServerlessScan,
} from "../gcp/gcp-registry-serverless.ts";
import type {
  RegistryScanInputs,
  ScanEstimateResult,
  ServerlessScanInputs,
} from "./scan.types.ts";

export function estimateRegistryScan(
  provider: CloudProvider,
  inputs: RegistryScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  switch (provider) {
    case "azure":
      return estimateAzureRegistryScan(inputs, rates);
    case "aws":
      return estimateAwsRegistryScan(inputs, rates);
    case "gcp":
      return estimateGcpRegistryScan(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}

export function estimateServerlessScan(
  provider: CloudProvider,
  inputs: ServerlessScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  switch (provider) {
    case "azure":
      return estimateAzureServerlessScan(inputs, rates);
    case "aws":
      return estimateAwsServerlessScan(inputs, rates);
    case "gcp":
      return estimateGcpServerlessScan(inputs, rates);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`unknown provider: ${_exhaustive}`);
    }
  }
}
