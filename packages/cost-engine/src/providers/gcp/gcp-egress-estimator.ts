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

/**
 * GCP VPC network internet/cross-cloud egress monthly cost.
 * `amount = billedEgressGb × ($/GB base rate × zone.rateMultiplier)`.
 * Egress volume defaults to the audit stream's monthly ingress GB when not
 * explicitly provided; Private Link/VPC Endpoint paths reduce billed volume
 * by `privatePathEgressFactor` (default 10%). Cross-cloud egress is never
 * modeled as free (fail closed), and unknown destination zones exclude the
 * line rather than inventing a rate. Skipped entirely when another meter
 * (e.g. stream ingress) already bills the same bytes (`alreadyBilledElsewhere`).
 *
 * @param inputs Egress volume/zone config. `enabled=false` → $0.
 * @param rates GCP RateCard; must carry `gcp-egress-gb`.
 * @returns billedEgressGB + ratePerGb actually applied, or excludedUnknownZone=true.
 * @see https://cloud.google.com/vpc/network-pricing
 */
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
