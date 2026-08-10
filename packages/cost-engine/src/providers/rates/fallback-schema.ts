/**
 * Shared fallback-prices.json schema + loaders for provider RatesAdapters.
 * Fail closed on non-USD; never invent $0 for missing meters.
 */
import fs from "node:fs";
import type { CloudProvider, RateCard } from "../../core/models/estimate.types.ts";
import {
  ageDaysFromCapturedAt,
  staleFallbackWarning,
} from "../../core/rates/age-days.ts";

/** One meter row in fallback-prices.json (AC schema). */
export interface FallbackMeterRow {
  meterId: string;
  unit: string;
  unitPrice: number;
  currency: "USD";
  capturedAt: string;
  sourceUrl: string;
}

export interface FallbackPricesDocument {
  provider: CloudProvider;
  region: string;
  currency: "USD";
  meters: FallbackMeterRow[];
}

export type RatesResult = {
  rates: RateCard;
  ratesSource: "live" | "cache" | "fallback";
  ageDays: number;
  warnings: string[];
  /** Package 16 freshness banner metadata (UI / export gate). */
  freshness?: import("../../core/rates/age-days.ts").RatesFreshness;
};

/**
 * Validate and normalize a fallback JSON document.
 * @throws if provider/region/currency invalid or meters invent non-USD / NaN prices
 */
export function parseFallbackDocument(raw: unknown): FallbackPricesDocument {
  if (!raw || typeof raw !== "object") {
    throw new Error("fallback-prices: document must be an object");
  }
  const doc = raw as Record<string, unknown>;
  const provider = doc.provider;
  if (provider !== "azure" && provider !== "aws" && provider !== "gcp") {
    throw new Error(`fallback-prices: invalid provider ${String(provider)}`);
  }
  if (typeof doc.region !== "string" || !doc.region) {
    throw new Error("fallback-prices: region required");
  }
  if (doc.currency !== "USD") {
    throw new Error("fallback-prices: currency must be USD (v1 fail closed)");
  }
  if (!Array.isArray(doc.meters)) {
    throw new Error("fallback-prices: meters[] required");
  }
  const meters: FallbackMeterRow[] = [];
  for (const row of doc.meters) {
    if (!row || typeof row !== "object") {
      throw new Error("fallback-prices: meter row must be object");
    }
    const m = row as Record<string, unknown>;
    if (typeof m.meterId !== "string" || !m.meterId || m.meterId === "none") {
      throw new Error("fallback-prices: meterId required (not none)");
    }
    if (typeof m.unit !== "string" || !m.unit) {
      throw new Error(`fallback-prices: unit required for ${m.meterId}`);
    }
    if (typeof m.unitPrice !== "number" || !Number.isFinite(m.unitPrice)) {
      throw new Error(`fallback-prices: unitPrice must be finite for ${m.meterId}`);
    }
    // Do not invent $0 placeholders — explicit zero only when vendor bills zero (rare).
    if (m.unitPrice < 0) {
      throw new Error(`fallback-prices: negative unitPrice for ${m.meterId}`);
    }
    if (m.currency !== "USD") {
      throw new Error(`fallback-prices: meter ${m.meterId} currency must be USD`);
    }
    if (typeof m.capturedAt !== "string" || Number.isNaN(Date.parse(m.capturedAt))) {
      throw new Error(`fallback-prices: capturedAt ISO required for ${m.meterId}`);
    }
    if (typeof m.sourceUrl !== "string" || !m.sourceUrl.startsWith("http")) {
      throw new Error(`fallback-prices: sourceUrl required for ${m.meterId}`);
    }
    meters.push({
      meterId: m.meterId,
      unit: m.unit,
      unitPrice: m.unitPrice,
      currency: "USD",
      capturedAt: m.capturedAt,
      sourceUrl: m.sourceUrl,
    });
  }
  return {
    provider,
    region: doc.region,
    currency: "USD",
    meters,
  };
}

export function loadFallbackFile(filePath: string): FallbackPricesDocument {
  const text = fs.readFileSync(filePath, "utf8");
  return parseFallbackDocument(JSON.parse(text));
}

/** Convert fallback doc → RateCard. Omits meters not present (no invented $0). */
export function fallbackToRateCard(doc: FallbackPricesDocument): RateCard {
  const unitPrices: Record<string, number> = {};
  let newest = doc.meters[0]?.capturedAt ?? new Date(0).toISOString();
  for (const m of doc.meters) {
    unitPrices[m.meterId] = m.unitPrice;
    if (Date.parse(m.capturedAt) > Date.parse(newest)) newest = m.capturedAt;
  }
  return {
    provider: doc.provider,
    region: doc.region,
    currency: "USD",
    unitPrices,
    capturedAt: newest,
  };
}

export function fallbackResult(
  doc: FallbackPricesDocument,
  extraWarnings: string[] = [],
  now: Date = new Date(),
): RatesResult {
  const rates = fallbackToRateCard(doc);
  const warnings = [...extraWarnings];
  const stale = staleFallbackWarning(rates.capturedAt, now);
  if (stale) warnings.push(stale);
  return {
    rates,
    ratesSource: "fallback",
    ageDays: ageDaysFromCapturedAt(rates.capturedAt, now),
    warnings,
  };
}

/**
 * Keep only USD live prices; empty after filter → caller must fall back.
 * Non-USD entries produce a warning (multi-currency fail closed to USD).
 */
export function filterUsdUnitPrices(
  raw: Record<string, { unitPrice: number; currency: string }>,
): { unitPrices: Record<string, number>; warnings: string[] } {
  const unitPrices: Record<string, number> = {};
  const warnings: string[] = [];
  let skippedNonUsd = 0;
  for (const [meterId, row] of Object.entries(raw)) {
    if (row.currency !== "USD") {
      skippedNonUsd += 1;
      continue;
    }
    if (!Number.isFinite(row.unitPrice) || row.unitPrice < 0) continue;
    unitPrices[meterId] = row.unitPrice;
  }
  if (skippedNonUsd > 0) {
    warnings.push(
      `skipped ${skippedNonUsd} non-USD price(s); v1 fail closed to USD`,
    );
  }
  return { unitPrices, warnings };
}
