/**
 * AWS egress estimator — Data Transfer out.
 * @see https://aws.amazon.com/ec2/pricing/on-demand/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateEgressForProvider } from "../egress/estimate-egress-core.ts";
import {
  AWS_EGRESS_ZONES,
  AWS_GOV_EGRESS_ZONES,
} from "../egress/egress-zone-cards.ts";
import type { EgressInputs, EgressResult } from "../egress/egress.types.ts";

/** Internet Data Transfer OUT base rate ($/GB); zone multipliers in `AWS_EGRESS_ZONES` scale it. */
export const AWS_EGRESS_METER = "aws-egress-gb";

/**
 * Data Transfer OUT estimate: `billedEgressGB × aws-egress-gb × zone.rateMultiplier`.
 *
 * `billedEgressGB` defaults from the audit stream's monthly ingress GB when no
 * explicit `egressGB` is given, is reduced to `privatePathEgressFactor` (default
 * 10%) when a Private Link/VPC endpoint path is used, and is zeroed when
 * `alreadyBilledElsewhere` is set (avoids double-counting with the Kinesis/ECR
 * meters that already carry their own egress). Cross-cloud egress is never
 * treated as free; unknown destination zones fail closed (excluded + warned,
 * never silently priced as $0).
 *
 * @param inputs Egress inputs; `enabled=false` → $0.
 * @param rates AWS RateCard — must carry provider "aws".
 * @returns Line item (if any), billed GB, effective $/GB, and totals.
 * @see https://aws.amazon.com/ec2/pricing/on-demand/ — Data Transfer OUT pricing.
 */
export function estimateAwsEgress(
  inputs: EgressInputs,
  rates: RateCard,
): EgressResult {
  return estimateEgressForProvider(
    "aws",
    {
      meterId: AWS_EGRESS_METER,
      providerLabel: "AWS",
      commercialZones: AWS_EGRESS_ZONES,
      govZones: AWS_GOV_EGRESS_ZONES,
    },
    inputs,
    rates,
  );
}
