/**
 * Simple in-process rate limiter for refreshRates (package 15 EDGE).
 * Fail closed with 429 when exceeded — never silent bypass.
 */
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function createRateLimiter(opts: {
  maxRequests: number;
  windowMs: number;
}): {
  check: (key: string, now?: number) => RateLimitResult;
  reset: () => void;
} {
  const hits = new Map<string, number[]>();
  return {
    reset() {
      hits.clear();
    },
    check(key: string, now = Date.now()): RateLimitResult {
      const windowStart = now - opts.windowMs;
      const prev = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (prev.length >= opts.maxRequests) {
        const oldest = prev[0] ?? now;
        const retryAfterSec = Math.max(
          1,
          Math.ceil((oldest + opts.windowMs - now) / 1000),
        );
        hits.set(key, prev);
        return { ok: false, retryAfterSec };
      }
      prev.push(now);
      hits.set(key, prev);
      return { ok: true };
    },
  };
}

/** Default: 10 refresh calls / minute / key */
export const refreshRatesLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60_000,
});
