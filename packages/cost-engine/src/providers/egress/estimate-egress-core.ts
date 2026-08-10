/**
 * Shared egress estimate body (package 11).
 */
import type {
  CloudProvider,
  LineItem,
  RateCard,
} from "../../core/models/estimate.types.ts";
import { isGovCloudRegion } from "../ads/ads.types.ts";
import {
  lookupEgressZone,
  type EgressZoneCard,
} from "./egress-zone-cards.ts";
import { priceQuantity, tieredPricingNote } from "../rates/tiered-rate.ts";
import {
  requireRate,
  resolveEgressGb,
  sumAmounts,
  type EgressInputs,
  type EgressResult,
} from "./egress.types.ts";

export const DEFAULT_PRIVATE_PATH_FACTOR = 0.1;

export type EgressProviderConfig = {
  meterId: string;
  providerLabel: string;
  commercialZones: readonly EgressZoneCard[];
  govZones: readonly EgressZoneCard[];
};

/**
 * Egress / cross-cloud bandwidth monthly estimate for one provider.
 *
 * `ratePerGb = baseRate(meterId) × zone.rateMultiplier`
 * `billedEgressGB = resolveEgressGb(inputs) × (privateLinkOrVpcEndpoint ? privatePathEgressFactor : 1)`
 * `amount = billedEgressGB × ratePerGb`
 *
 * Zone card is looked up from `config.govZones` when the source region looks
 * like Gov/restricted, else `config.commercialZones` (@see egress-zone-cards.ts).
 * Unrecognized `destinationZone` excludes the line and warns rather than
 * inventing a free/default rate (fail closed).
 *
 * @param inputs.alreadyBilledElsewhere Skip entirely (returns $0, no line item)
 * to avoid double-counting egress a different meter (stream/registry) already covers.
 * @returns $0 result when `inputs.enabled` is false, when `alreadyBilledElsewhere`,
 * or when the destination zone is unrecognized (`excludedUnknownZone: true`).
 * @throws when `rates.provider` doesn't match `provider`; when a cross-cloud
 * zone card somehow carries a non-positive multiplier (never-free invariant);
 * when `privatePathEgressFactor` is outside 0–1; or when the base meter price is missing.
 */
export function estimateEgressForProvider(
  provider: CloudProvider,
  config: EgressProviderConfig,
  inputs: EgressInputs,
  rates: RateCard,
): EgressResult {
  if (rates.provider !== provider) {
    throw new Error(`estimateEgress requires ${provider} RateCard`);
  }

  const notes: string[] = [
    "Egress confidence Medium-Low (Low) — zone rates are approximated from public bandwidth pages.",
    "Never assume free cross-cloud egress.",
  ];

  if (!inputs.enabled) {
    return {
      lineItems: [],
      totals: { expected: 0 },
      billedEgressGB: 0,
      ratePerGb: null,
      warnings: [],
      notes,
      confidence: "Low",
      excludedUnknownZone: false,
    };
  }

  if (inputs.alreadyBilledElsewhere) {
    notes.push(
      "alreadyBilledElsewhere=true — excluded to avoid double-counting stream/registry egress meters",
    );
    return {
      lineItems: [],
      totals: { expected: 0 },
      billedEgressGB: 0,
      ratePerGb: null,
      warnings: [
        "egress skipped: already billed elsewhere (no double-count)",
      ],
      notes,
      confidence: "Low",
      excludedUnknownZone: false,
    };
  }

  const warnings: string[] = [];
  const gov = isGovCloudRegion(inputs.region);
  const cards = gov ? config.govZones : config.commercialZones;
  if (gov) {
    warnings.push(
      `${config.providerLabel} Gov/restricted region '${inputs.region}' — using separate Gov bandwidth SKU card (do not mix commercial rates)`,
    );
  }

  const zone = lookupEgressZone(cards, inputs.destinationZone);
  if (!zone) {
    warnings.push(
      `unknown destination zone '${inputs.destinationZone}' — egress excluded (fail closed; no invented free/rate)`,
    );
    return {
      lineItems: [],
      totals: { expected: 0 },
      billedEgressGB: 0,
      ratePerGb: null,
      warnings,
      notes,
      confidence: "Low",
      excludedUnknownZone: true,
    };
  }

  // Never treat cross-cloud as free even if multiplier somehow 0
  if (zone.zone === "cross-cloud" && zone.rateMultiplier <= 0) {
    throw new Error("cross-cloud egress must not be free (fail closed)");
  }

  let egressGb = resolveEgressGb(inputs);
  notes.push(
    inputs.egressGB !== undefined
      ? `explicit egressGB=${egressGb}`
      : `audit default egress from stream ingress GB/month=${egressGb}`,
  );

  if (inputs.privateLinkOrVpcEndpoint) {
    const factor =
      inputs.privatePathEgressFactor ?? DEFAULT_PRIVATE_PATH_FACTOR;
    if (factor < 0 || factor > 1) {
      throw new Error("privatePathEgressFactor must be 0–1");
    }
    egressGb = egressGb * factor;
    notes.push(
      `Private Link / VPC Endpoint path: egress reduced to ${factor * 100}% of volume`,
    );
  }

  // Egress is graduated. The zone multiplier scales the whole ladder rather
  // than a single rate: a destination that costs 1.2x costs 1.2x in every
  // band, so applying it to the graduated total is equivalent to applying it
  // to each band and keeps the published boundaries intact.
  const basePrice = priceQuantity(rates, config.meterId, egressGb);
  const amount = basePrice.amount * zone.rateMultiplier;
  const ratePerGb =
    egressGb > 0
      ? amount / egressGb
      : basePrice.effectiveUnitPrice * zone.rateMultiplier;
  const tierNote = tieredPricingNote(config.meterId, basePrice);
  if (tierNote) notes.push(tierNote);

  const lineItems: LineItem[] = [
    {
      provider,
      capability: "audit_logs",
      meterId: config.meterId,
      amount,
      confidence: "Low",
    },
  ];
  notes.push(
    `zone=${zone.zone} (${zone.label}); ratePerGb=${ratePerGb}` +
      (basePrice.tiered ? " (blended across published tiers)" : ""),
  );

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    billedEgressGB: egressGb,
    ratePerGb,
    warnings,
    notes,
    confidence: "Low",
    excludedUnknownZone: false,
  };
}
