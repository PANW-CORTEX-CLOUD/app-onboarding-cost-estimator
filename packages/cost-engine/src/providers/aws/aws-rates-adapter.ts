/**
 * AWS RatesAdapter — Price List API shape with in-repo fallback for us-east-1.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RatesAdapter } from "../../core/ports/rates-adapter.interface.ts";
import type { RateCard } from "../../core/models/estimate.types.ts";
import { ageDaysFromCapturedAt } from "../../core/rates/age-days.ts";
import { mergeLiveOverFallback } from "../rates/merge-live-rates.ts";
import {
  fallbackResult,
  filterUsdUnitPrices,
  loadFallbackFile,
  type RatesResult,
} from "../rates/fallback-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AWS_DEFAULT_REGION = "us-east-1";
export const AWS_FALLBACK_PRICES_PATH = path.join(
  __dirname,
  "fallback-prices.json",
);

export const AWS_PRICE_LIST_INDEX_URL =
  "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json";

/** Simplified Price List product attributes used in unit tests / smoke. */
export type AwsPriceListProduct = {
  sku?: string;
  attributes?: { meterId?: string; location?: string };
};
export type AwsPriceListPrice = {
  pricePerUnit?: Record<string, string>;
};
export type AwsPriceListResponse = {
  products?: Record<string, AwsPriceListProduct>;
  terms?: {
    OnDemand?: Record<string, Record<string, { priceDimensions?: Record<string, AwsPriceListPrice> }>>;
  };
  currency?: string;
};

export type AwsRatesAdapterOptions = {
  fetchImpl?: typeof fetch;
  fallbackPath?: string;
  forceFallback?: boolean;
  now?: Date;
};

/**
 * Parse a simplified AWS Price List document into unitPrices.
 * Expects products keyed with attributes.meterId and OnDemand USD pricePerUnit.USD.
 */
export function parseAwsPriceList(
  body: AwsPriceListResponse,
): { unitPrices: Record<string, number>; warnings: string[] } {
  const raw: Record<string, { unitPrice: number; currency: string }> = {};
  const currency = body.currency ?? "USD";
  const products = body.products ?? {};
  const onDemand = body.terms?.OnDemand ?? {};

  for (const [sku, product] of Object.entries(products)) {
    const meterId = product.attributes?.meterId;
    if (!meterId) continue;
    const skuTerms = onDemand[sku];
    if (!skuTerms) continue;
    for (const term of Object.values(skuTerms)) {
      const dims = term.priceDimensions ?? {};
      for (const dim of Object.values(dims)) {
        const usd = dim.pricePerUnit?.USD ?? dim.pricePerUnit?.[currency];
        if (usd === undefined) continue;
        const n = Number(usd);
        if (!Number.isFinite(n)) continue;
        raw[meterId] = { unitPrice: n, currency };
      }
    }
  }
  return filterUsdUnitPrices(raw);
}

export function createAwsRatesAdapter(
  opts: AwsRatesAdapterOptions = {},
): RatesAdapter {
  const fallbackPath = opts.fallbackPath ?? AWS_FALLBACK_PRICES_PATH;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? new Date();

  return {
    provider: "aws",
    async getRates(region: string): Promise<RatesResult> {
      const doc = loadFallbackFile(fallbackPath);
      const warnings: string[] = [];
      const effectiveRegion = region?.trim() || AWS_DEFAULT_REGION;
      if (effectiveRegion.toLowerCase() !== doc.region.toLowerCase()) {
        warnings.push(
          `unknown or unsupported aws region '${effectiveRegion}'; using fallback region '${doc.region}'`,
        );
      }

      if (opts.forceFallback) {
        return fallbackResult(doc, warnings, now);
      }

      try {
        // Live index fetch validates connectivity; full offer download is heavy —
        // unit tests inject a complete mock body via fetchImpl.
        const res = await fetchImpl(AWS_PRICE_LIST_INDEX_URL);
        if (!res.ok) {
          warnings.push(`aws price list HTTP ${res.status}; using fallback`);
          return fallbackResult(doc, warnings, now);
        }
        const body = (await res.json()) as AwsPriceListResponse;
        // Real index.json has offers, not products — treat missing products as empty → fallback
        if (!body.products || Object.keys(body.products).length === 0) {
          warnings.push(
            "aws price list index has no parseable products; using fallback",
          );
          return fallbackResult(doc, warnings, now);
        }
        const parsed = parseAwsPriceList(body);
        warnings.push(...parsed.warnings);
        if (Object.keys(parsed.unitPrices).length === 0) {
          warnings.push("aws price list produced no USD meters; using fallback");
          return fallbackResult(doc, warnings, now);
        }
        // Layer live prices over the in-repo document rather than replacing it:
        // a live query that covers only some meters must not leave the rest
        // unpriced, and published tier ladders have to survive the merge.
        const mergedRates = mergeLiveOverFallback(
          "aws",
          doc,
          parsed.unitPrices,
          new Date().toISOString(),
        );
        warnings.push(...mergedRates.warnings);
        const rates: RateCard = mergedRates.rates;
        return {
          rates,
          ratesSource: "live",
          ageDays: ageDaysFromCapturedAt(rates.capturedAt, now),
          warnings,
        };
      } catch (err) {
        warnings.push(
          `aws price list error: ${err instanceof Error ? err.message : String(err)}; using fallback`,
        );
        return fallbackResult(doc, warnings, now);
      }
    },
  };
}
