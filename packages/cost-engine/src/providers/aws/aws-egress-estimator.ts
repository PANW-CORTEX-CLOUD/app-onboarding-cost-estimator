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

export const AWS_EGRESS_METER = "aws-egress-gb";

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
