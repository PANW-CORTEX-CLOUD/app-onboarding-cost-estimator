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

/**
 * Registry scanning is billed as network egress, not as a registry meter.
 *
 * The AmazonECR price list has no data-transfer meter: ECR bills storage plus standard AWS data transfer out. Same-region pulls are not charged.
 *
 * The estimator previously used an invented per-GB "pull bandwidth" meter that
 * matches no vendor SKU. Pointing it at the real egress meter keeps the number
 * defensible and keeps same-region scanning at $0, which is what actually happens.
 *
 * @see https://aws.amazon.com/ec2/pricing/on-demand/
 */
export const AWS_REGISTRY_METER = "aws-egress-gb";
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
