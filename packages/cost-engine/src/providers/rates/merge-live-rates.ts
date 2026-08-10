/**
 * Merging live prices over the in-repo rate document without losing ladders.
 *
 * Each provider adapter fetches a handful of live prices and merges them over
 * the checked-in document, so meters the live query did not cover keep their
 * known price rather than becoming an invented $0. That merge rebuilt
 * `unitPrices` from scratch, which silently discarded `unitTiers` — so
 * graduated pricing worked from the fallback file and vanished the moment a
 * live or cached rate card was used, with nothing in the output to say so.
 *
 * That is the worst kind of defect: same inputs, different answer, no warning.
 * The rule here makes the choice explicit per meter:
 *
 * - **Live price matches the ladder's first paid band** — the ladder still
 *   describes this meter, so keep it.
 * - **Live price differs** — the vendor has re-priced. The boundaries we
 *   recorded may be stale too, and mixing a fresh price with stale boundaries
 *   would invent a ladder nobody published. Drop to flat and warn.
 *
 * Never silently flatten.
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import type { PriceTier } from "../../core/graduated-pricing.ts";
import type { FallbackPricesDocument } from "./fallback-schema.ts";

export interface MergedLiveRates {
  rates: RateCard;
  warnings: string[];
}

/** Price equality within a cent-of-a-cent, to tolerate float representation. */
const PRICE_EPSILON = 1e-9;

function samePrice(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Build a RateCard from live prices layered over the in-repo document.
 *
 * @param provider cloud the card belongs to
 * @param doc the checked-in rate document (prices and ladders)
 * @param livePrices meterId → live unit price, for the meters the query covered
 * @param capturedAt timestamp for the resulting card
 */
export function mergeLiveOverFallback(
  provider: CloudProvider,
  doc: FallbackPricesDocument,
  livePrices: Record<string, number>,
  capturedAt: string,
): MergedLiveRates {
  const unitPrices: Record<string, number> = {};
  const unitTiers: Record<string, PriceTier[]> = {};
  const warnings: string[] = [];

  for (const meter of doc.meters) {
    const live = livePrices[meter.meterId];
    const price = live ?? meter.unitPrice;
    unitPrices[meter.meterId] = price;

    if (!meter.tiers) continue;

    if (live === undefined || samePrice(live, meter.unitPrice)) {
      // Either the live query did not cover this meter, or it confirmed the
      // price we already recorded — the ladder still applies.
      unitTiers[meter.meterId] = meter.tiers;
    } else {
      warnings.push(
        `${meter.meterId}: live price ${live} differs from the recorded ${meter.unitPrice}, so its published tier boundaries may be stale too — pricing this meter flat at the live rate. Re-run \`pnpm rates:validate --write\` to refresh the ladder.`,
      );
    }
  }

  // Live meters the document does not know about are still honoured, but they
  // have no ladder by definition.
  for (const [meterId, price] of Object.entries(livePrices)) {
    if (!(meterId in unitPrices)) unitPrices[meterId] = price;
  }

  return {
    rates: {
      provider,
      region: doc.region,
      currency: "USD",
      unitPrices,
      ...(Object.keys(unitTiers).length ? { unitTiers } : {}),
      capturedAt,
    },
    warnings,
  };
}
