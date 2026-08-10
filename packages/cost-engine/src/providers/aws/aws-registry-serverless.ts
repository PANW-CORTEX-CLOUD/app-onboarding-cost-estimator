/**
 * AWS registry (ECR) + serverless (Lambda) scan estimators.
 * @see https://aws.amazon.com/ecr/pricing/
 * @see https://aws.amazon.com/lambda/pricing/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import {
  estimateRegistryScanForProvider,
  estimateServerlessScanForProvider,
} from "../registry-serverless/estimate-scan-core.ts";
import type {
  RegistryScanInputs,
  ScanEstimateResult,
  ServerlessScanInputs,
} from "../registry-serverless/scan.types.ts";

export const AWS_REGISTRY_METER = "ecr-data-transfer";
export const AWS_SERVERLESS_METER = "lambda-scan-ops";

export function estimateAwsRegistryScan(
  inputs: RegistryScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  return estimateRegistryScanForProvider(
    "aws",
    { pullMeterId: AWS_REGISTRY_METER, providerLabel: "AWS" },
    inputs,
    rates,
  );
}

export function estimateAwsServerlessScan(
  inputs: ServerlessScanInputs,
  rates: RateCard,
): ScanEstimateResult {
  return estimateServerlessScanForProvider(
    "aws",
    { opsMeterId: AWS_SERVERLESS_METER, providerLabel: "AWS" },
    inputs,
    rates,
  );
}
