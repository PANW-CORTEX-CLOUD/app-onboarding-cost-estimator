/**
 * Azure egress estimator — Bandwidth pricing zones.
 * @see https://azure.microsoft.com/en-us/pricing/details/bandwidth/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateEgressForProvider } from "../egress/estimate-egress-core.ts";
import {
  AZURE_EGRESS_ZONES,
  AZURE_GOV_EGRESS_ZONES,
} from "../egress/egress-zone-cards.ts";
import type { EgressInputs, EgressResult } from "../egress/egress.types.ts";

export const AZURE_EGRESS_METER = "azure-egress-gb";

export function estimateAzureEgress(
  inputs: EgressInputs,
  rates: RateCard,
): EgressResult {
  return estimateEgressForProvider(
    "azure",
    {
      meterId: AZURE_EGRESS_METER,
      providerLabel: "Azure",
      commercialZones: AZURE_EGRESS_ZONES,
      govZones: AZURE_GOV_EGRESS_ZONES,
    },
    inputs,
    rates,
  );
}
