/**
 * GCP RatesAdapter — Cloud Billing Catalog shape with in-repo fallback for us-central1.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RatesAdapter } from "../../core/ports/rates-adapter.interface.ts";
import type { RateCard } from "../../core/models/estimate.types.ts";
import { ageDaysFromCapturedAt } from "../../core/rates/age-days.ts";
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
export const GCP_BILLING_CATALOG_QUERY_URL =
  "https://cloudbilling.googleapis.com/v1/services";

export type GcpCatalogSku = {
  skuId?: string;
  description?: string;
  /** Our meterId when mocking catalog rows */
  meterId?: string;
  pricingInfo?: Array<{
    pricingExpression?: {
      tieredRates?: Array<{ unitPrice?: { currencyCode?: string; nanos?: number; units?: string } }>;
    };
  }>;
};

export type GcpCatalogResponse = {
  skus?: GcpCatalogSku[];
};

export type GcpRatesAdapterOptions = {
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
 * (nanos are 1e-9 fractional units, per the API's Money type), taking only
 * the first tiered rate (no volume-tier discounting modeled).
 * @see https://cloud.google.com/billing/docs/how-to/get-pricing-information-api
 */
export function parseGcpBillingCatalog(
  body: GcpCatalogResponse,
): { unitPrices: Record<string, number>; warnings: string[] } {
  const raw: Record<string, { unitPrice: number; currency: string }> = {};
  for (const sku of body.skus ?? []) {
    const meterId = sku.meterId;
    if (!meterId) continue;
    const tier =
      sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.[0]?.unitPrice;
    if (!tier) continue;
    const units = Number(tier.units ?? 0);
    const nanos = (tier.nanos ?? 0) / 1e9;
    raw[meterId] = {
      unitPrice: units + nanos,
      currency: tier.currencyCode ?? "USD",
    };
  }
  return filterUsdUnitPrices(raw);
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

      try {
        const res = await fetchImpl(GCP_BILLING_CATALOG_QUERY_URL);
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
        const rates: RateCard = {
          provider: "gcp",
          region: doc.region,
          currency: "USD",
          unitPrices: parsed.unitPrices,
          capturedAt: new Date().toISOString(),
        };
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
