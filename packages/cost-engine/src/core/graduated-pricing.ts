/**
 * Graduated (tiered) pricing.
 *
 * Cloud storage and egress are not billed at one rate. The published price is a
 * ladder: the first N units cost one rate, the next M cost less, and so on —
 * and each band is charged at *its own* rate, not the whole volume at the band
 * the total lands in. Charging the first-tier rate throughout, which is what
 * this estimator used to do, over-states every large estate.
 *
 * The boundaries are published machine-readably and were read from the vendors
 * themselves: Azure's Retail Prices API exposes `tierMinimumUnits`, and AWS's
 * Price List exposes `beginRange`/`endRange`.
 *
 * ## Free allowances are tiers too
 *
 * Azure expresses its 100 GB/month free egress as a real tier: minimum units 0
 * at a unit price of $0.00, with the first paid band starting at 100. That is
 * convenient but dangerous to apply blindly, because **the allowance is per
 * subscription and shared across every service in it**. This estimator prices
 * one workload inside a subscription that is probably already consuming the
 * allowance for something else, so honouring it by default would understate the
 * bill. Free tiers are therefore dropped unless a caller explicitly opts in.
 *
 * @see https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
 * @see https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html
 */

/** One band of a published price ladder. */
export interface PriceTier {
  /**
   * Units at which this band starts, inclusive. The first band must start at 0.
   * Mirrors Azure's `tierMinimumUnits` and AWS's `beginRange`.
   */
  fromUnits: number;
  /** Price per unit within this band. */
  unitPrice: number;
}

export interface GraduatedCostBreakdown {
  /** Total cost across all bands. */
  amount: number;
  /** Per-band detail, for notes that let a reviewer follow the arithmetic. */
  bands: Array<{
    fromUnits: number;
    toUnits: number | null;
    units: number;
    unitPrice: number;
    amount: number;
  }>;
}

/**
 * Validate a tier ladder.
 *
 * @throws when the ladder is empty, unsorted, does not start at 0, repeats a
 *         boundary, or contains a non-finite/negative price — any of which
 *         would make the cost silently wrong rather than obviously broken
 */
export function assertValidTiers(tiers: readonly PriceTier[]): void {
  if (tiers.length === 0) {
    throw new Error("price tiers: at least one tier required");
  }
  if (tiers[0]!.fromUnits !== 0) {
    throw new Error(
      `price tiers: first tier must start at 0, got ${tiers[0]!.fromUnits}`,
    );
  }
  for (let i = 0; i < tiers.length; i += 1) {
    const t = tiers[i]!;
    if (!Number.isFinite(t.fromUnits) || t.fromUnits < 0) {
      throw new Error(`price tiers: invalid fromUnits ${t.fromUnits}`);
    }
    if (!Number.isFinite(t.unitPrice) || t.unitPrice < 0) {
      throw new Error(
        `price tiers: invalid unitPrice ${t.unitPrice} at tier ${t.fromUnits}`,
      );
    }
    if (i > 0 && t.fromUnits <= tiers[i - 1]!.fromUnits) {
      throw new Error(
        `price tiers: boundaries must strictly increase (${tiers[i - 1]!.fromUnits} then ${t.fromUnits})`,
      );
    }
  }
}

/**
 * Cost of `quantity` units against a graduated ladder.
 *
 * Each band is charged for the units that fall inside it. A quantity sitting
 * exactly on a boundary belongs to the *lower* band — the boundary is where the
 * next band begins, so nothing is double counted.
 *
 * @param quantity units consumed; must be finite and non-negative
 * @param tiers ladder, validated before use
 * @throws when quantity is negative or not finite, or the ladder is malformed
 */
export function graduatedCost(
  quantity: number,
  tiers: readonly PriceTier[],
): GraduatedCostBreakdown {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(
      `graduatedCost: quantity must be a non-negative number, got ${quantity}`,
    );
  }
  assertValidTiers(tiers);

  const bands: GraduatedCostBreakdown["bands"] = [];
  let amount = 0;

  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i]!;
    const next = tiers[i + 1];
    const toUnits = next ? next.fromUnits : null;

    if (quantity <= tier.fromUnits) break;

    const upper = toUnits === null ? quantity : Math.min(quantity, toUnits);
    const units = upper - tier.fromUnits;
    if (units <= 0) continue;

    const bandAmount = units * tier.unitPrice;
    amount += bandAmount;
    bands.push({
      fromUnits: tier.fromUnits,
      toUnits,
      units,
      unitPrice: tier.unitPrice,
      amount: bandAmount,
    });
  }

  return { amount, bands };
}

/**
 * Drop a leading free band, re-pricing those units at the first paid rate.
 *
 * Used when a caller has not opted into free allowances. The published
 * boundaries above the free band are kept exactly as the vendor states them —
 * only the free band's price changes — because those boundaries are what the
 * vendor bills against regardless of who consumed the allowance.
 *
 * A ladder with no free band is returned unchanged.
 */
export function withoutFreeTier(tiers: readonly PriceTier[]): PriceTier[] {
  assertValidTiers(tiers);
  if (tiers[0]!.unitPrice !== 0) return [...tiers];

  const firstPaid = tiers.find((t) => t.unitPrice > 0);
  if (!firstPaid) {
    // Everything is free per the vendor — nothing to re-price.
    return [...tiers];
  }
  return tiers.map((t) =>
    t.unitPrice === 0 && t.fromUnits < firstPaid.fromUnits
      ? { ...t, unitPrice: firstPaid.unitPrice }
      : { ...t },
  );
}

/**
 * Effective blended rate, for display next to a tiered line.
 * Zero quantity has no meaningful blended rate, so it reports the first tier's.
 */
export function blendedUnitPrice(
  quantity: number,
  tiers: readonly PriceTier[],
): number {
  if (quantity <= 0) return tiers[0]?.unitPrice ?? 0;
  return graduatedCost(quantity, tiers).amount / quantity;
}

/**
 * Human summary of which bands a quantity touched, for estimate notes.
 * Keeps the arithmetic auditable without reading the source.
 */
export function describeBands(breakdown: GraduatedCostBreakdown): string {
  if (breakdown.bands.length === 0) return "no billable units";
  return breakdown.bands
    .map(
      (b) =>
        `${b.units.toLocaleString("en-US", { maximumFractionDigits: 2 })} units @ $${b.unitPrice}` +
        (b.toUnits === null
          ? ` (over ${b.fromUnits.toLocaleString("en-US")})`
          : ` (${b.fromUnits.toLocaleString("en-US")}–${b.toUnits.toLocaleString("en-US")})`),
    )
    .join(" + ");
}
