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
 * The Amazon ECR price list has no data-transfer meter: ECR bills storage
 * plus standard AWS data transfer out. Same-region pulls are not charged.
 *
 * The estimator previously used an invented per-GB "pull bandwidth" meter
 * that matched no vendor SKU (`ecr-data-transfer`). Pointing it at the real
 * egress meter keeps the number defensible and keeps same-region scanning
 * at $0, which is what actually happens.
 *
 * @see https://aws.amazon.com/ec2/pricing/on-demand/
 */
export const AWS_REGISTRY_METER = "aws-egress-gb";
/** Lambda request-count rate ($/million invocations) for incremental package scans. */
export const AWS_SERVERLESS_METER = "lambda-scan-ops";

/**
 * ECR registry-scan estimate: incremental pull bandwidth only, never existing
 * image storage. `pullGb = imageCount × avgImageGB × scansPerMonth`; billed as
 * `pullGb × aws-egress-gb` (real AWS Data Transfer OUT meter) **only when
 * `crossRegionPull` is true** — same-region ECR pulls stay within the AWS
 * network and are modeled as $0 (matches ECR's "no charge for image pulls"
 * behavior for in-region traffic).
 *
 * @param inputs Registry scan inputs; `enabled=false` → $0.
 * @param rates AWS RateCard — must carry provider "aws".
 * @returns Line item (amount 0 when same-region) and totals, confidence "Low".
 * @see https://aws.amazon.com/ecr/pricing/
 */
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

/**
 * Lambda serverless-scan estimate: incremental scan invocations only, never
 * function/package storage. `ops = packageCount × scansPerMonth`; billed as
 * `(ops / 1,000,000) × lambda-scan-ops` ($/million requests — Lambda's request
 * pricing dimension). Compute duration (GB-second) is **not** modeled — the
 * rate card only carries the per-request meter, so this under-represents total
 * Lambda cost for scans with non-trivial execution time (documented Low
 * confidence gap; see `docs/CLOUD_COST_MODEL.md` unit "GB-second + requests").
 *
 * @param inputs Serverless scan inputs; `enabled=false` → $0.
 * @param rates AWS RateCard — must carry provider "aws".
 * @returns Line item and totals, confidence "Low".
 * @see https://aws.amazon.com/lambda/pricing/
 */
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
