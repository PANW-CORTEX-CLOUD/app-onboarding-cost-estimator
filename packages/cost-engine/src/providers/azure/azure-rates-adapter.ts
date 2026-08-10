/**
 * Azure RatesAdapter — Retail Prices API with in-repo fallback for eastus.
 * Live parse is injectable for unit tests; failures fall back (no throw).
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
export const AZURE_DEFAULT_REGION = "eastus";
export const AZURE_FALLBACK_PRICES_PATH = path.join(
  __dirname,
  "fallback-prices.json",
);

/** Azure Retail Prices API endpoint (public, no auth). */
export const AZURE_RETAIL_PRICES_QUERY_URL =
  "https://prices.azure.com/api/retail/prices";

/** meterId → retail API meterName substring (mock + live filter helper). */
export const AZURE_METER_NAME_HINTS: Record<string, string> = {
  "eh-standard-tu": "Throughput Unit",
  "eh-standard-ingress-events": "Ingress Events",
  "blob-hot-lrs-capacity": "Hot LRS Data Stored",
  "managed-disk-snapshot": "Snapshot",
};

export type AzureRetailItem = {
  meterName?: string;
  retailPrice?: number;
  currencyCode?: string;
  armRegionName?: string;
  unitOfMeasure?: string;
};

export type AzureRetailResponse = {
  Items?: AzureRetailItem[];
};

export type AzureRatesAdapterOptions = {
  fetchImpl?: typeof fetch;
  fallbackPath?: string;
  /** When true, skip live and return fallback (offline tests). */
  forceFallback?: boolean;
  now?: Date;
};

/**
 * Parse Azure Retail Prices Items into meterId → USD unitPrice.
 * Only maps meters with known hints; unmapped Items are ignored (no invent).
 */
export function parseAzureRetailPrices(
  body: AzureRetailResponse,
  meterHints: Record<string, string> = AZURE_METER_NAME_HINTS,
): { unitPrices: Record<string, number>; warnings: string[] } {
  const raw: Record<string, { unitPrice: number; currency: string }> = {};
  const items = body.Items ?? [];
  for (const [meterId, hint] of Object.entries(meterHints)) {
    const hit = items.find(
      (it) =>
        typeof it.meterName === "string" &&
        it.meterName.toLowerCase().includes(hint.toLowerCase()) &&
        typeof it.retailPrice === "number",
    );
    if (!hit || hit.retailPrice === undefined) continue;
    raw[meterId] = {
      unitPrice: hit.retailPrice,
      currency: hit.currencyCode ?? "USD",
    };
  }
  return filterUsdUnitPrices(raw);
}

export function createAzureRatesAdapter(
  opts: AzureRatesAdapterOptions = {},
): RatesAdapter {
  const fallbackPath = opts.fallbackPath ?? AZURE_FALLBACK_PRICES_PATH;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? new Date();

  return {
    provider: "azure",
    async getRates(region: string): Promise<RatesResult> {
      const doc = loadFallbackFile(fallbackPath);
      const warnings: string[] = [];
      const effectiveRegion = region?.trim() || AZURE_DEFAULT_REGION;
      if (effectiveRegion.toLowerCase() !== doc.region.toLowerCase()) {
        warnings.push(
          `unknown or unsupported azure region '${effectiveRegion}'; using fallback region '${doc.region}'`,
        );
      }

      if (opts.forceFallback) {
        return fallbackResult(doc, warnings, now);
      }

      try {
        const url = `${AZURE_RETAIL_PRICES_QUERY_URL}?$filter=armRegionName eq '${doc.region}' and serviceName eq 'Event Hubs'&$top=100`;
        const res = await fetchImpl(url);
        if (!res.ok) {
          warnings.push(`azure retail HTTP ${res.status}; using fallback`);
          return fallbackResult(doc, warnings, now);
        }
        const body = (await res.json()) as AzureRetailResponse;
        if (!body.Items || body.Items.length === 0) {
          warnings.push("azure retail empty Items; using fallback");
          return fallbackResult(doc, warnings, now);
        }
        const parsed = parseAzureRetailPrices(body);
        warnings.push(...parsed.warnings);
        if (Object.keys(parsed.unitPrices).length === 0) {
          warnings.push("azure retail produced no USD meters; using fallback");
          return fallbackResult(doc, warnings, now);
        }
        // Merge: live overrides known meters; keep fallback for meters live missed (no invent $0).
        const merged = { ...doc.meters.reduce<Record<string, number>>((acc, m) => {
          acc[m.meterId] = m.unitPrice;
          return acc;
        }, {}), ...parsed.unitPrices };
        const rates: RateCard = {
          provider: "azure",
          region: doc.region,
          currency: "USD",
          unitPrices: merged,
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
          `azure retail error: ${err instanceof Error ? err.message : String(err)}; using fallback`,
        );
        return fallbackResult(doc, warnings, now);
      }
    },
  };
}
