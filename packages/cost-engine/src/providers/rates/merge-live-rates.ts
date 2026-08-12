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
    const rawLive = livePrices[meter.meterId];

    // REQ-23 (T-23.2.1). A live $0 for a meter this document prices above zero
    // is treated as a failed lookup, not as news that the meter became free.
    // Everything upstream that can produce a spurious zero — a partial payload,
    // a free introductory tier, a field this parser did not understand — arrives
    // here looking exactly like a real price, and this is the last place with
    // something to compare it against: a rate the crawler actually verified
    // against the vendor's own price list (`pnpm rates:validate`).
    //
    // The trade is deliberate and one-directional. If a vendor genuinely drops a
    // meter to $0 we keep quoting the old, higher rate until someone re-runs the
    // validator — the warning says exactly that. Overcharging on paper and
    // saying so is recoverable; silently zeroing a billable line is the failure
    // this whole requirement exists to stop.
    const liveIsSuspectZero =
      rawLive !== undefined && rawLive === 0 && meter.unitPrice > 0;
    if (liveIsSuspectZero) {
      warnings.push(
        `${meter.meterId}: live lookup returned $0 but the verified price is ${meter.unitPrice}; keeping the verified price. A live zero is treated as a failed lookup, not a price drop — re-run \`pnpm rates:validate --write\` if this meter really is free now.`,
      );
    }
    const live = liveIsSuspectZero ? undefined : rawLive;
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
  //
  // The T-23.2.1 zero-guard above deliberately does not extend here: it works by
  // contradiction against a verified price, and a meter the document never
  // recorded has none, so there is nothing to contradict. Accepting the zero is
  // not a judgement that it is right — it is the absence of any basis to call it
  // wrong. Low risk in practice because estimates price meters the capability
  // map names, and those are the document's own; a meter no estimate reads
  // cannot mis-price one.
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
