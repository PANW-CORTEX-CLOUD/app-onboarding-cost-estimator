/**
 * Local last-estimate cache for offline / fail-closed recovery (package 17 EDGE).
 * Stores API responses only — never invents $0 line items.
 */
import type { components } from "../api/generated/openapi.types.ts";
import type { CloudProvider } from "../model/cloud-provider.ts";

type EstimateResponse = components["schemas"]["EstimateResponse"];

const KEY = "cloud-connector:last-estimate:v1";

export type CachedEstimate = {
  provider: CloudProvider;
  estimate: EstimateResponse;
  cachedAt: string;
};

/** Overwrite the single last-estimate slot (one cache entry total, not per-provider). */
export function saveEstimateCache(entry: CachedEstimate): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(entry));
}

/**
 * Read back the last cached estimate. There is no time-based expiry here —
 * "stale" is judged elsewhere from `ratesAsOf`/`modelVersion` on the cached
 * estimate itself, not from `cachedAt`. The only invalidation this function
 * does is a provider match: since the cache holds one entry, an estimate
 * cached for a different provider is treated as absent (`null`) rather than
 * returned as a mismatched fallback.
 * @param provider When given, only return the cache if it was cached for this provider.
 */
export function loadEstimateCache(
  provider?: CloudProvider,
): CachedEstimate | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedEstimate;
    if (!parsed?.estimate || !parsed?.provider || !parsed?.cachedAt) return null;
    if (provider && parsed.provider !== provider) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEstimateCache(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
