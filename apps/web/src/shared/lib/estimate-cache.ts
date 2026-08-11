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
 * The fields the estimator UI actually renders off a cached estimate.
 *
 * A shallow "is `estimate` present?" check is not enough. The cache key is
 * versioned (`:v1`), but nothing stops a browser from holding an entry written
 * by an older build whose `EstimateResponse` shape differed — a persistence
 * drift that would sail past a presence check and then render `$NaN` when the UI
 * reads `totals.expected`, or throw when it maps over a non-array `lineItems`.
 * Validating the load-bearing fields here turns that into a clean cache miss
 * (re-fetch from the API) instead of a corrupt render — fail-closed, same stance
 * the share-link path takes (REQ-11).
 */
function isRenderableEstimate(estimate: unknown): estimate is EstimateResponse {
  if (!estimate || typeof estimate !== "object") return false;
  const e = estimate as Record<string, unknown>;
  const totals = e.totals as Record<string, unknown> | undefined;
  if (!totals || typeof totals.expected !== "number" || !Number.isFinite(totals.expected)) {
    return false;
  }
  if (!Array.isArray(e.lineItems)) return false;
  if (typeof e.provider !== "string") return false;
  return true;
}

/**
 * Read back the last cached estimate. There is no time-based expiry here —
 * "stale" is judged elsewhere from `ratesAsOf`/`modelVersion` on the cached
 * estimate itself, not from `cachedAt`. Invalidation here is twofold: a provider
 * match (the cache holds one entry, so an estimate cached for a different
 * provider is treated as absent), and a structural check that the cached
 * estimate still has the shape the UI will render (guards persistence drift
 * across app versions). Either mismatch returns `null` — a cache miss the caller
 * resolves by re-fetching — rather than a corrupt or mismatched fallback.
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
    // Fail closed on a cached shape the UI cannot render (persistence drift).
    if (!isRenderableEstimate(parsed.estimate)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEstimateCache(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
