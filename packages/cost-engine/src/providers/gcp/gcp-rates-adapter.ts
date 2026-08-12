/**
 * GCP RatesAdapter — Cloud Billing Catalog shape with in-repo fallback for us-central1.
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
export const GCP_DEFAULT_REGION = "us-central1";
export const GCP_FALLBACK_PRICES_PATH = path.join(
  __dirname,
  "fallback-prices.json",
);

/** Public docs URL — live catalog typically needs API key (package 16 refresh). */
const GCP_BILLING_CATALOG_QUERY_URL =
  "https://cloudbilling.googleapis.com/v1/services";

export type GcpCatalogSku = {
  skuId?: string;
  description?: string;
  /** Our meterId when mocking catalog rows */
  meterId?: string;
  pricingInfo?: Array<{
    pricingExpression?: {
      tieredRates?: Array<{
        /**
         * Usage is priced at this tier's rate only *after* this amount, so a SKU
         * with a free allowance leads with `startUsageAmount: 0` at $0 and prices
         * the real rate from the next tier up.
         */
        startUsageAmount?: number;
        unitPrice?: { currencyCode?: string; nanos?: number; units?: string };
      }>;
    };
  }>;
};

export type GcpCatalogResponse = {
  skus?: GcpCatalogSku[];
};

/**
 * Read the Billing Catalog key from the environment, lazily and defensively.
 * Absent in the browser, and a sandboxed frame can throw on property access,
 * so a failure here means "no key" rather than breaking an estimate.
 */
function readGcpApiKeyFromEnv(): string | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process;
    const key = proc?.env?.GCP_BILLING_API_KEY;
    return key && key.trim() ? key.trim() : undefined;
  } catch {
    return undefined;
  }
}

export type GcpRatesAdapterOptions = {
  /**
   * Cloud Billing Catalog API key. Falls back to `GCP_BILLING_API_KEY`.
   * Without one the adapter serves the crawler-verified file and says so.
   */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  fallbackPath?: string;
  forceFallback?: boolean;
  now?: Date;
};

/**
 * Parse GCP Billing Catalog SKUs (simplified) into USD unitPrices.
 * Prefers explicit sku.meterId (tests); otherwise no invent.
 *
 * Reconstructs the SKU's decimal unit price from the Billing Catalog API's
 * `Money`-style `{units, nanos}` pair: `unitPrice = units + nanos / 1e9`
 * (nanos are 1e-9 fractional units, per the API's Money type).
 *
 * Volume tiers are not modelled — each meter gets one flat rate — but the tier
 * that rate is taken from is the first one that actually **charges**, not
 * literally `tieredRates[0]`, so a SKU leading with a free allowance is not
 * priced at $0 for all volume (REQ-23). Skipping a free head tier is reported
 * in `warnings`, because it overstates small volumes.
 * @see https://cloud.google.com/billing/docs/how-to/get-pricing-information-api
 */
export function parseGcpBillingCatalog(
  body: GcpCatalogResponse,
): { unitPrices: Record<string, number>; warnings: string[] } {
  const raw: Record<string, { unitPrice: number; currency: string | undefined }> = {};
  /** Parse-time warnings, merged with the currency filter's own below. */
  const warnings: string[] = [];
  for (const sku of body.skus ?? []) {
    const meterId = sku.meterId;
    if (!meterId) continue;
    const tiers = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates;
    if (!tiers?.length) continue;

    // REQ-23 (T-23.1.1). Reading `tieredRates[0]` unconditionally prices a SKU
    // that leads with a free allowance at $0 for *all* volume — the Billing
    // Catalog expresses "first 20GB free, then $10/GB" as tier 0 at $0 with
    // `startUsageAmount: 0`, then the real rate at `startUsageAmount: 20`. So the
    // first tier is the wrong one to read whenever a later tier is priced.
    //
    // Why not "reject a SKU whose price fields are missing", which is what this
    // was first written up as: in the canonical proto3 JSON mapping a field at
    // its default value is *omitted*, so a genuinely free tier and a truncated
    // response are byte-identical on the wire — `{"currencyCode":"USD"}` either
    // way. Absence cannot be distinguished from zero here, so this does not try;
    // it picks the tier that actually charges instead.
    // @see https://protobuf.dev/programming-guides/json/ (default values omitted;
    //      int64 encoded as a decimal string, which is why `units` is a string)
    //
    // Erring toward the paid tier is the deliberate direction: pricing a billable
    // meter at $0 understates a customer's bill silently, while a flat paid rate
    // overstates the free head of the curve and says so in a warning. Same choice
    // `mergeLiveOverFallback` makes when a live price contradicts a known ladder.
    //
    // The Azure adapter reaches the same principle from the opposite mechanical
    // direction, and the pair is worth reading together before touching either:
    // Azure's bands are volume *discounts*, so it deliberately keeps the lowest
    // `tierMinimumUnits` band because "picking a higher tier would understate the
    // price a typical, non-bulk customer actually pays". GCP's tier 0 can be a
    // free *allowance*, so keeping it is what understates. Different rule, one
    // invariant: never let tier selection quote a customer less than they pay.
    let chosen: { unitPrice: number; currency: string | undefined } | undefined;
    let skippedFreeTiers = 0;
    for (const tierRate of tiers) {
      const money = tierRate?.unitPrice;
      if (!money) continue;
      // `units` is an int64-as-string; `nanos` are 1e-9 fractional units.
      const price = Number(money.units ?? 0) + (money.nanos ?? 0) / 1e9;
      // No `?? "USD"`: the currency the response stated is passed through as-is,
      // so `filterUsdUnitPrices` can tell "no currency" from "a currency we do
      // not accept" (REQ-23 T-23.1.2).
      const candidate = { unitPrice: price, currency: money.currencyCode };
      chosen ??= candidate; // keep tier 0 as the answer for an all-free SKU
      if (price > 0) {
        if (chosen.unitPrice === 0) {
          chosen = candidate;
          skippedFreeTiers += 1;
        }
        break;
      }
    }
    if (!chosen) continue;
    if (skippedFreeTiers > 0) {
      warnings.push(
        `${meterId}: skipped a $0 introductory tier and priced flat at the first charged rate (${chosen.unitPrice}); this SKU has a free allowance that v1 does not model, so small volumes are overstated`,
      );
    }
    raw[meterId] = chosen;
  }
  const filtered = filterUsdUnitPrices(raw);
  return {
    unitPrices: filtered.unitPrices,
    warnings: [...warnings, ...filtered.warnings],
  };
}

export function createGcpRatesAdapter(
  opts: GcpRatesAdapterOptions = {},
): RatesAdapter {
  const fallbackPath = opts.fallbackPath ?? GCP_FALLBACK_PRICES_PATH;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? new Date();

  return {
    provider: "gcp",
    async getRates(region: string): Promise<RatesResult> {
      const doc = loadFallbackFile(fallbackPath);
      const warnings: string[] = [];
      const effectiveRegion = region?.trim() || GCP_DEFAULT_REGION;
      if (effectiveRegion.toLowerCase() !== doc.region.toLowerCase()) {
        warnings.push(
          `unknown or unsupported gcp region '${effectiveRegion}'; using fallback region '${doc.region}'`,
        );
      }

      if (opts.forceFallback) {
        return fallbackResult(doc, warnings, now);
      }

      // The Cloud Billing Catalog API refuses unauthenticated callers
      // ("Method doesn't allow unregistered callers"), so without a key the
      // fetch below cannot succeed. Saying that plainly beats making a doomed
      // request and reporting it as a transient failure — the capability is
      // absent, not flaky.
      const apiKey = opts.apiKey ?? readGcpApiKeyFromEnv();
      if (!apiKey) {
        warnings.push(
          "gcp live rates need a Cloud Billing Catalog API key; set GCP_BILLING_API_KEY to enable them. Using the crawler-verified fallback file — refresh with `pnpm rates:validate --write`",
        );
        return fallbackResult(doc, warnings, now);
      }

      try {
        const res = await fetchImpl(
          `${GCP_BILLING_CATALOG_QUERY_URL}?key=${encodeURIComponent(apiKey)}`,
        );
        if (!res.ok) {
          warnings.push(`gcp billing catalog HTTP ${res.status}; using fallback`);
          return fallbackResult(doc, warnings, now);
        }
        const body = (await res.json()) as GcpCatalogResponse;
        if (!body.skus || body.skus.length === 0) {
          warnings.push("gcp billing catalog empty skus; using fallback");
          return fallbackResult(doc, warnings, now);
        }
        const parsed = parseGcpBillingCatalog(body);
        warnings.push(...parsed.warnings);
        if (Object.keys(parsed.unitPrices).length === 0) {
          warnings.push("gcp catalog produced no USD meters; using fallback");
          return fallbackResult(doc, warnings, now);
        }
        // Layer live prices over the in-repo document rather than replacing it:
        // a live query that covers only some meters must not leave the rest
        // unpriced, and published tier ladders have to survive the merge.
        const mergedRates = mergeLiveOverFallback(
          "gcp",
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
          `gcp billing catalog error: ${err instanceof Error ? err.message : String(err)}; using fallback`,
        );
        return fallbackResult(doc, warnings, now);
      }
    },
  };
}
