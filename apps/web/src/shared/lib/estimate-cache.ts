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

/**
 * The `EstimateResponse` fields the UI actually reads off a cached entry, and
 * the fields the OpenAPI contract marks `required`. Kept as a runtime list
 * because `apps/web` has no schema validator (it consumes generated types
 * only, so `as EstimateResponse` is a compile-time cast that proves nothing at
 * runtime).
 */
const REQUIRED_ESTIMATE_FIELDS = [
  "provider",
  "lineItems",
  "totals",
  "confidence",
  "modelVersion",
  "ratesAsOf",
  "inputHash",
] as const;

/**
 * Structural guard against **persistence drift**: a blob written by an older
 * build whose `EstimateResponse` shape has since changed must not be trusted
 * just because it parses. The storage key is versioned (`:v1`) but bumped by
 * hand, so a contract change that forgets the bump would otherwise let a stale,
 * differently-shaped estimate render as if it were live. Validating the
 * required fields on read makes the cache **fail closed** — a drifted or
 * partial blob is treated as absent (`null`) and the app re-fetches — rather
 * than fail open into a malformed render.
 *
 * Deliberately checks only the load-bearing top-level fields, not every nested
 * property: the goal is to reject a genuinely wrong *shape* (missing totals,
 * lineItems that aren't an array), not to re-implement the whole schema the
 * server already validated when it produced the response.
 */
function isEstimateResponseShape(value: unknown): value is EstimateResponse {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  for (const field of REQUIRED_ESTIMATE_FIELDS) {
    if (e[field] === undefined || e[field] === null) return false;
  }
  if (!Array.isArray(e.lineItems)) return false;
  if (typeof e.totals !== "object" || e.totals === null) return false;
  if (typeof (e.totals as Record<string, unknown>).expected !== "number") {
    return false;
  }
  if (typeof e.provider !== "string") return false;
  if (typeof e.modelVersion !== "string") return false;
  if (typeof e.ratesAsOf !== "string") return false;
  return true;
}

/** Overwrite the single last-estimate slot (one cache entry total, not per-provider). */
export function saveEstimateCache(entry: CachedEstimate): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(entry));
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
    // Fail closed on persistence drift: a blob that parses but no longer
    // matches the EstimateResponse shape must be ignored, not rendered.
    if (!isEstimateResponseShape(parsed.estimate)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearEstimateCache(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
