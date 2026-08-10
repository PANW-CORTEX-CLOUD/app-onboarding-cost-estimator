/**
 * Pricing a quantity against a meter, honouring a published price ladder.
 *
 * Every estimator used to write `quantity * requireRate(...)`, which is only
 * correct for flat-rate meters. Storage and egress are graduated: the first N
 * units cost one rate and later bands cost less, each charged at its own rate.
 * This is the single place that decides which of the two applies, so adding a
 * ladder to a meter changes every estimator at once instead of none of them.
 *
 * @see core/graduated-pricing.ts for the ladder arithmetic and the reasoning
 *      behind free allowances being opt-in
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import {
  describeBands,
  graduatedCost,
  withoutFreeTier,
  type PriceTier,
} from "../../core/graduated-pricing.ts";

export interface TieredPriceResult {
  /** Cost of the quantity. */
  amount: number;
  /** Rate used for a flat meter, or the blended rate across bands. */
  effectiveUnitPrice: number;
  /** True when a published ladder was applied rather than a single rate. */
  tiered: boolean;
  /** Band-by-band explanation, for estimate notes. Empty for flat meters. */
  bandsNote: string;
}

export interface TieredPriceOptions {
  /**
   * Honour a free opening band (Azure's first 100 GB of egress, say).
   *
   * Off by default, and deliberately so: those allowances are granted per
   * subscription and shared across every service in it, so a subscription that
   * already uses its allowance elsewhere would get an understated quote. The
   * conservative reading is that the allowance is spent.
   */
  applyFreeAllowances?: boolean;
}

/**
 * Look up a meter and price `quantity` against it.
 *
 * @throws when the meter has no price — never falls back to zero, because an
 *         invented $0 is indistinguishable from a real one in the output
 */
export function priceQuantity(
  rates: RateCard,
  meterId: string,
  quantity: number,
  opts: TieredPriceOptions = {},
): TieredPriceResult {
  const flatRate = rates.unitPrices[meterId];
  if (flatRate === undefined) {
    throw new Error(`missing unit price for meter '${meterId}' (no invented $0)`);
  }

  const ladder = rates.unitTiers?.[meterId];
  if (!ladder || ladder.length <= 1) {
    return {
      amount: quantity * flatRate,
      effectiveUnitPrice: flatRate,
      tiered: false,
      bandsNote: "",
    };
  }

  const effective: PriceTier[] = opts.applyFreeAllowances
    ? [...ladder]
    : withoutFreeTier(ladder);
  const breakdown = graduatedCost(quantity, effective);

  return {
    amount: breakdown.amount,
    effectiveUnitPrice: quantity > 0 ? breakdown.amount / quantity : flatRate,
    tiered: true,
    bandsNote: describeBands(breakdown),
  };
}

/**
 * Note describing how a tiered line was priced, for the estimate's notes list.
 * Returns null for a flat meter, so callers can spread it without a branch.
 */
export function tieredPricingNote(
  meterId: string,
  result: TieredPriceResult,
  opts: TieredPriceOptions = {},
): string | null {
  if (!result.tiered) return null;
  const allowance = opts.applyFreeAllowances
    ? "free allowance applied"
    : "free allowance assumed already spent elsewhere in the subscription";
  return `${meterId} priced across published tiers: ${result.bandsNote} (${allowance}; blended $${result.effectiveUnitPrice.toFixed(6)}/unit).`;
}
