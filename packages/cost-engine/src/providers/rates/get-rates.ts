/**
 * Multi-cloud getRates(provider, region) facade (packages 04 + 16).
 * live → 24h cache → fallback. forceLive skips cache. Never invents $0 meters.
 * CORS: browser clients must use API proxy only (never call cloud price APIs directly).
 */
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import { UpstreamRateError } from "../../core/errors.ts";
import type { RatesAdapter } from "../../core/ports/rates-adapter.interface.ts";
import {
  evaluateRatesFreshness,
  type RatesFreshness,
} from "../../core/rates/age-days.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import type { RatesResult } from "./fallback-schema.ts";
import {
  createRatesCache,
  defaultRatesCache,
  ratesCacheKey,
  type RatesCache,
} from "./rates-cache.ts";

export type GetRatesOptions = {
  adapters?: Partial<Record<CloudProvider, RatesAdapter>>;
  /** Skip cache and hit adapter (refreshRates AC). */
  forceLive?: boolean;
  /** Inject cache (tests). Default: process-wide 24h cache. */
  cache?: RatesCache;
  now?: Date;
};

const defaultAdapters = (): Record<CloudProvider, RatesAdapter> => ({
  azure: createAzureRatesAdapter(),
  aws: createAwsRatesAdapter(),
  gcp: createGcpRatesAdapter(),
});

/** Stamp `ageDays`/`freshness`/banner onto a `RatesResult` relative to `now`, deduping the banner into `warnings`. */
function withFreshness(
  result: RatesResult,
  now: Date,
  ratesSource: RatesResult["ratesSource"] = result.ratesSource,
): RatesResult {
  const freshness: RatesFreshness = evaluateRatesFreshness(
    result.rates.capturedAt,
    ratesSource,
    now,
  );
  const warnings = [...(result.warnings ?? [])];
  if (freshness.banner && !warnings.includes(freshness.banner)) {
    warnings.push(freshness.banner);
  }
  return {
    ...result,
    ratesSource,
    ageDays: freshness.ageDays,
    warnings,
    freshness,
  };
}

/**
 * Resolve rates for a provider + region.
 *
 * Precedence: process-wide 24h cache (@see rates-cache.ts `RATES_CACHE_TTL_MS`)
 * unless `opts.forceLive`, → provider adapter (which itself tries live pricing
 * API then falls back to its bundled fallback-prices.json on failure/empty
 * response). A cache hit reports `ratesSource: "cache"` and skips network
 * entirely; an expired/missing entry always calls the adapter and re-caches
 * the result under `ratesCacheKey(provider, region)`.
 *
 * Every returned unit price is validated finite/non-negative before caching —
 * fails closed (throws) rather than caching a corrupt/partial price row.
 * @param provider Any string; only "azure"/"aws"/"gcp" resolve real rates —
 * anything else returns an empty fallback RateCard + warning (no invented meters).
 * @throws {UpstreamRateError} when the adapter itself throws (rate source down)
 * or returns a non-finite/negative unit price (corrupt source data). Both are
 * upstream failures, not caller input, so the API maps them to 502 not 400.
 */
export async function getRates(
  provider: string,
  region: string,
  opts: GetRatesOptions = {},
): Promise<RatesResult> {
  const now = opts.now ?? new Date();
  const cache = opts.cache ?? defaultRatesCache;
  const adapters = { ...defaultAdapters(), ...opts.adapters };

  if (provider !== "azure" && provider !== "aws" && provider !== "gcp") {
    const rates: RateCard = {
      provider: "azure",
      region: region || "unknown",
      currency: "USD",
      unitPrices: {},
      capturedAt: new Date(0).toISOString(),
    };
    return withFreshness(
      {
        rates,
        ratesSource: "fallback",
        ageDays: Number.POSITIVE_INFINITY,
        warnings: [
          `unknown provider '${provider}'; returning empty RateCard (no invented $0 meters)`,
        ],
      },
      now,
      "fallback",
    );
  }

  const key = ratesCacheKey(provider, region);

  if (!opts.forceLive) {
    const hit = cache.get(key, now.getTime());
    if (hit) {
      return withFreshness(hit, now, "cache");
    }
  }

  // An adapter is designed to fall back to its bundled prices internally, so a
  // throw here is the rate *source* failing outright (a broken adapter, an
  // outage the fallback could not cover) — an upstream dependency failure, not
  // the caller's fault. Mark it so the API can render an honest 5xx instead of
  // a 400 that blames the request.
  let result: Awaited<ReturnType<RatesAdapter["getRates"]>>;
  try {
    result = await adapters[provider].getRates(region);
  } catch (e) {
    throw new UpstreamRateError(
      `rate adapter for '${provider}' failed to resolve rates for '${region}'`,
      { cause: e },
    );
  }
  const normalized: RatesResult = {
    ...result,
    warnings: result.warnings ?? [],
  };

  // EDGE: never invent $0 for missing meters — empty unitPrices only when
  // adapter explicitly returned fallback-empty (unknown provider path above).
  // A non-finite/negative price is corrupt *source* data (live or bundled), not
  // a client input, so it fails closed as an upstream error, not a 400.
  for (const [meterId, price] of Object.entries(normalized.rates.unitPrices)) {
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      throw new UpstreamRateError(
        `partial/invalid meter '${meterId}' — fail closed (no invented $0)`,
      );
    }
  }

  cache.set(key, normalized, now.getTime());
  return withFreshness(normalized, now, normalized.ratesSource);
}

/**
 * Look up a meter's price without inventing a $0 default.
 * @returns `undefined` when the meter is absent (distinct from a real $0 price).
 */
export function lookupUnitPrice(
  rates: RateCard,
  meterId: string,
): number | undefined {
  // Explicit undefined — never coerce missing meters to $0
  if (!(meterId in rates.unitPrices)) return undefined;
  return rates.unitPrices[meterId];
}

export { createRatesCache, defaultRatesCache, ratesCacheKey };
export type { RatesCache };
