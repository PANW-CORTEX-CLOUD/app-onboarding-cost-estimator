/**
 * Azure egress estimator — Bandwidth pricing zones.
 *
 * Provider-meter wrapper around the shared `estimateEgressForProvider` (package 11,
 * `providers/egress/estimate-egress-core.ts`) — `amount = billedEgressGB × baseRate
 * × zone.rateMultiplier` and the Gov-zone-card / Private Link discount / same-region
 * $0 / unknown-zone fail-closed logic all live there; Azure supplies only the
 * `azure-egress-gb` base meter and its commercial/Gov zone cards.
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/bandwidth/
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import { estimateEgressForProvider } from "../egress/estimate-egress-core.ts";
import {
  AZURE_EGRESS_ZONES,
  AZURE_GOV_EGRESS_ZONES,
} from "../egress/egress-zone-cards.ts";
import type { EgressInputs, EgressResult } from "../egress/egress.types.ts";

/** Base $/GB egress rate; scaled per-destination by the zone card's `rateMultiplier`. */
export const AZURE_EGRESS_METER = "azure-egress-gb";

/**
 * @param inputs Egress toggle, destination zone, and volume signals.
 * @param rates Azure RateCard — must carry provider "azure" and `azure-egress-gb`.
 * @returns $0 result when disabled, `alreadyBilledElsewhere`, or the destination
 *   zone is unrecognized (fail closed — never an invented free/default rate).
 */
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
