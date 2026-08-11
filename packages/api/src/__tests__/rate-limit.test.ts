/**
 * Rate limiter counting/window/retry-after behaviour.
 *
 * This was previously exercised only indirectly, through the
 * `/v1/rates/refresh` HTTP test that looped live requests until it tripped —
 * which made the counting behaviour hostage to the network. Testing the
 * limiter directly here lets the HTTP test just confirm the 429 wiring
 * without any fetch (see openapi-rest.test.ts, TODO(REQ-15)).
 */
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../rate-limit.ts";

describe("createRateLimiter", () => {
  it("allows up to maxRequests, then blocks within the window", () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    const now = 1_000_000;
    expect(limiter.check("k", now).ok).toBe(true);
    expect(limiter.check("k", now).ok).toBe(true);
    expect(limiter.check("k", now).ok).toBe(true);
    const blocked = limiter.check("k", now);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("counts each key independently", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const now = 2_000_000;
    expect(limiter.check("a", now).ok).toBe(true);
    expect(limiter.check("a", now).ok).toBe(false);
    // A different key is unaffected by 'a' being exhausted.
    expect(limiter.check("b", now).ok).toBe(true);
  });

  it("frees a slot once the window has fully passed", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    const t0 = 3_000_000;
    expect(limiter.check("k", t0).ok).toBe(true);
    expect(limiter.check("k", t0).ok).toBe(false);
    // EDGE: exactly one window later the earlier hit has aged out.
    expect(limiter.check("k", t0 + 1_001).ok).toBe(true);
  });

  it("retryAfterSec reflects how long until the oldest hit ages out", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const t0 = 4_000_000;
    limiter.check("k", t0);
    // 10s into the 60s window, ~50s should remain (ceil, min 1).
    const blocked = limiter.check("k", t0 + 10_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(49);
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(51);
    }
  });

  it("reset() clears all counts", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const now = 5_000_000;
    expect(limiter.check("k", now).ok).toBe(true);
    expect(limiter.check("k", now).ok).toBe(false);
    limiter.reset();
    expect(limiter.check("k", now).ok).toBe(true);
  });
});
