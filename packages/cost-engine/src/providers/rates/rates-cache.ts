/**
 * In-memory rates cache with TTL (package 16).
 * Cache hits skip network; expired entries refetch. Never invents meters.
 */
import type { RatesResult } from "./fallback-schema.ts";
import { RATES_CACHE_TTL_MS } from "../../core/rates/age-days.ts";

type CacheEntry = {
  storedAtMs: number;
  result: RatesResult;
};

export type RatesCache = {
  get: (key: string, nowMs?: number) => RatesResult | undefined;
  set: (key: string, result: RatesResult, nowMs?: number) => void;
  clear: () => void;
  size: () => number;
};

/** Cache key: `provider:region` with region trimmed + lowercased (case/whitespace-insensitive). */
export function ratesCacheKey(provider: string, region: string): string {
  return `${provider}:${region.trim().toLowerCase()}`;
}

/**
 * In-memory rates cache. An entry is fresh while `now - storedAtMs <= ttlMs`;
 * strictly greater than `ttlMs` is expired (so a hit exactly at the TTL
 * boundary still counts as fresh). Expired entries are evicted lazily on
 * `get` (self-healing — no background sweep needed).
 * @param opts.ttlMs Default `RATES_CACHE_TTL_MS` (24h).
 */
export function createRatesCache(
  opts: { ttlMs?: number } = {},
): RatesCache {
  const ttlMs = opts.ttlMs ?? RATES_CACHE_TTL_MS;
  const store = new Map<string, CacheEntry>();

  return {
    get(key: string, nowMs = Date.now()): RatesResult | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (nowMs - hit.storedAtMs > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return hit.result;
    },
    set(key: string, result: RatesResult, nowMs = Date.now()): void {
      store.set(key, { storedAtMs: nowMs, result });
    },
    clear() {
      store.clear();
    },
    size() {
      return store.size;
    },
  };
}

/** Process-wide default cache (24h TTL). */
export const defaultRatesCache = createRatesCache();
