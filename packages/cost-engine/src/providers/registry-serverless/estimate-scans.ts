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

/**
 * Route to the per-provider registry-scan estimator (ACR/ECR/Artifact Registry);
 * each wraps the shared formula in `estimate-scan-core.ts` with its own meter id.
 */
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

/**
 * Route to the per-provider serverless-scan estimator (Functions/Lambda/Cloud Run);
 * each wraps the shared formula in `estimate-scan-core.ts` with its own meter id.
 */
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
