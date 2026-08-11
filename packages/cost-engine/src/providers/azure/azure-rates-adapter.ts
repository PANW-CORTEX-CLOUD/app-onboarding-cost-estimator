/**
 * Azure RatesAdapter — Retail Prices API with in-repo fallback for eastus.
 * Live parse is injectable for unit tests; failures fall back (no throw).
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
export const AZURE_DEFAULT_REGION = "eastus";
export const AZURE_FALLBACK_PRICES_PATH = path.join(
  __dirname,
  "fallback-prices.json",
);

/** Azure Retail Prices API endpoint (public, no auth). */
const AZURE_RETAIL_PRICES_QUERY_URL =
  "https://prices.azure.com/api/retail/prices";

/**
 * meterId → retail API disambiguation hint (mock + live filter helper).
 *
 * `meterName` is a case-insensitive **substring** match (not exact) so terse
 * test fixtures keep working. The Retail Prices API frequently returns several
 * SKUs/products sharing a `meterName` substring — e.g. `serviceName eq 'Event
 * Hubs'` returns both "Basic Throughput Unit" ($0.015/hr) and "Standard
 * Throughput Unit" ($0.03/hr) for a bare "Throughput Unit" match, and Blob's
 * "Hot LRS Data Stored" meterName is shared by Blob Storage, Azure Files, and
 * both ADLS Gen2 namespace modes. `skuName`/`productName` narrow to the exact
 * SKU/product this codebase models (verified live 2026-08 — see EDGE note in
 * `parseAzureRetailPrices`); they are a *soft* preference, applied only when
 * at least one candidate actually carries that value, so hand-built mocks
 * that omit them still match on `meterName` alone.
 */
export type AzureMeterHint = {
  /** Retail API `serviceName` this meter's SKU is queried under. */
  serviceName: string;
  meterName: string;
  /** Disambiguates SKU tiers sharing a meterName (e.g. "Standard" vs "Basic"). */
  skuName?: string;
  /** Disambiguates products sharing a meterName (e.g. "Blob Storage" vs "Files v2"). */
  productName?: string;
};

export const AZURE_METER_NAME_HINTS: Record<string, AzureMeterHint> = {
  "eh-standard-tu": {
    serviceName: "Event Hubs",
    meterName: "Throughput Unit",
    skuName: "Standard",
  },
  "eh-standard-ingress-events": {
    serviceName: "Event Hubs",
    meterName: "Ingress Events",
    skuName: "Standard",
  },
  "blob-hot-lrs-capacity": {
    serviceName: "Storage",
    meterName: "Hot LRS Data Stored",
    productName: "Blob Storage",
  },
  "managed-disk-snapshot": {
    serviceName: "Storage",
    meterName: "LRS Snapshots",
    productName: "Standard HDD Managed Disks",
  },
};

export type AzureRetailItem = {
  meterName?: string;
  retailPrice?: number;
  currencyCode?: string;
  armRegionName?: string;
  unitOfMeasure?: string;
  /** SKU tier label, e.g. "Standard" / "Basic" — disambiguates shared meterNames. */
  skuName?: string;
  /** Billed product family, e.g. "Blob Storage" / "Files v2" — same purpose. */
  productName?: string;
  /** Lower bound of a tiered-price band (billed units); 0/absent = base rate. */
  tierMinimumUnits?: number;
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
 * Narrow `candidates` to those whose `field` case-insensitively equals `want` —
 * but only when that actually narrows to a non-empty set. This is a *soft*
 * preference, not a hard filter: callers (including hand-built test fixtures)
 * that omit the field on every candidate fall through with the set unchanged,
 * so `parseAzureRetailPrices` keeps matching on `meterName` alone when richer
 * SKU metadata isn't present.
 */
function preferField(
  candidates: AzureRetailItem[],
  field: "skuName" | "productName",
  want: string | undefined,
): AzureRetailItem[] {
  if (!want) return candidates;
  const narrowed = candidates.filter(
    (c) => typeof c[field] === "string" && c[field]!.toLowerCase() === want.toLowerCase(),
  );
  return narrowed.length > 0 ? narrowed : candidates;
}

/**
 * Parse Azure Retail Prices Items into meterId → USD unitPrice.
 * Only maps meters with known hints; unmapped Items are ignored (no invent).
 *
 * EDGE (verified live against the Retail Prices API 2026-08): a bare
 * `meterName`-substring match picks `items.find`'s first hit, which is
 * order-dependent and provably ambiguous for two of our four meters —
 * `serviceName eq 'Event Hubs'` alone returns *both* "Basic Throughput Unit"
 * and "Standard Throughput Unit" for a "Throughput Unit" substring (2×
 * price difference), and "LRS Snapshots" matches Standard HDD **and**
 * Premium SSD Managed Disks **and** Premium Page Blob snapshot SKUs (up to
 * 2.6× price difference) — the API gives no ordering guarantee, so relying
 * on "whichever comes first" risks silently pricing the wrong SKU. Candidates
 * are narrowed by `skuName`/`productName` (@see preferField) when the hint
 * specifies one, then by the lowest/base `tierMinimumUnits` band (Blob
 * capacity is tiered at 50TB/500TB breakpoints; picking a higher tier would
 * understate the price a typical, non-bulk customer actually pays).
 */
export function parseAzureRetailPrices(
  body: AzureRetailResponse,
  meterHints: Record<string, AzureMeterHint> = AZURE_METER_NAME_HINTS,
): { unitPrices: Record<string, number>; warnings: string[] } {
  const raw: Record<string, { unitPrice: number; currency: string }> = {};
  const items = body.Items ?? [];
  for (const [meterId, hint] of Object.entries(meterHints)) {
    let candidates = items.filter(
      (it) =>
        typeof it.meterName === "string" &&
        it.meterName.toLowerCase().includes(hint.meterName.toLowerCase()) &&
        typeof it.retailPrice === "number",
    );
    if (candidates.length === 0) continue;
    candidates = preferField(candidates, "skuName", hint.skuName);
    candidates = preferField(candidates, "productName", hint.productName);
    const baseTier = candidates.filter(
      (c) => c.tierMinimumUnits === undefined || c.tierMinimumUnits === 0,
    );
    const hit = (baseTier.length > 0 ? baseTier : candidates)[0];
    if (!hit || hit.retailPrice === undefined) continue;
    raw[meterId] = {
      unitPrice: hit.retailPrice,
      currency: hit.currencyCode ?? "USD",
    };
  }
  return filterUsdUnitPrices(raw);
}

/**
 * Build the Retail Prices API `$filter` for `region`, scoped to exactly the
 * `serviceName`s and `meterName` substrings named in `AZURE_METER_NAME_HINTS`.
 *
 * EDGE: the original query only filtered `serviceName eq 'Event Hubs'`, so
 * `blob-hot-lrs-capacity` and `managed-disk-snapshot` (serviceName "Storage")
 * could never be live-refreshed — they silently always fell back, despite
 * being declared in the hints map. Storage carries thousands of unrelated
 * SKUs, so broadening to `serviceName eq 'Storage'` alone (without also
 * narrowing by meterName server-side) would risk `$top` truncating the
 * response before it reaches our target rows; the meterName OR-clause below
 * keeps the result set small regardless of `$top`.
 */
export function buildAzureRetailFilter(region: string): string {
  const serviceNames = [
    ...new Set(Object.values(AZURE_METER_NAME_HINTS).map((h) => h.serviceName)),
  ];
  const meterNames = [
    ...new Set(Object.values(AZURE_METER_NAME_HINTS).map((h) => h.meterName)),
  ];
  const serviceClause = serviceNames
    .map((s) => `serviceName eq '${s}'`)
    .join(" or ");
  const meterClause = meterNames
    .map((m) => `contains(meterName, '${m}')`)
    .join(" or ");
  return `armRegionName eq '${region}' and (${serviceClause}) and (${meterClause})`;
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
        const url = `${AZURE_RETAIL_PRICES_QUERY_URL}?$filter=${buildAzureRetailFilter(doc.region)}&$top=100`;
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
        // Merge live over the in-repo document, preserving published tier
        // ladders. Rebuilding unitPrices by hand used to drop them silently.
        const mergedRates = mergeLiveOverFallback(
          "azure",
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
          `azure retail error: ${err instanceof Error ? err.message : String(err)}; using fallback`,
        );
        return fallbackResult(doc, warnings, now);
      }
    },
  };
}
