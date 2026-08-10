/**
 * GCP egress estimator — VPC network internet egress.
 * @see https://cloud.google.com/vpc/network-pricing
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateEgressForProvider } from "../egress/estimate-egress-core.ts";
import {
  GCP_EGRESS_ZONES,
  GCP_GOV_EGRESS_ZONES,
} from "../egress/egress-zone-cards.ts";
import type { EgressInputs, EgressResult } from "../egress/egress.types.ts";

export const GCP_EGRESS_METER = "gcp-egress-gb";

export function estimateGcpEgress(
  inputs: EgressInputs,
  rates: RateCard,
): EgressResult {
  return estimateEgressForProvider(
    "gcp",
    {
      meterId: GCP_EGRESS_METER,
      providerLabel: "GCP",
      commercialZones: GCP_EGRESS_ZONES,
      govZones: GCP_GOV_EGRESS_ZONES,
    },
    inputs,
    rates,
  );
}
