/**
 * REQ-18 — a cached estimate must be structurally valid before it is rendered.
 *
 * The cache is single-user localStorage, so the realistic corruption is not an
 * attacker but **persistence drift**: an entry written by an older build whose
 * `EstimateResponse` shape differed, surviving under the same `:v1` key. A
 * shallow presence check would return it and the UI would render `$NaN` or throw
 * on a non-array `lineItems`. `loadEstimateCache` now fails closed on such an
 * entry — a cache miss the caller resolves by re-fetching.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearEstimateCache,
  loadEstimateCache,
  saveEstimateCache,
  type CachedEstimate,
} from "../estimate-cache.ts";

const KEY = "cloud-connector:last-estimate:v1";

function validEntry(): CachedEstimate {
  return {
    provider: "azure",
    cachedAt: "2026-08-11T00:00:00.000Z",
    // Minimal EstimateResponse with the fields the UI renders.
    estimate: {
      provider: "azure",
      totals: { expected: 42.5, low: 40, high: 45 },
      lineItems: [],
      confidence: "Med",
      ratesAsOf: "2026-08-10T00:00:00.000Z",
      ratesSource: "fallback",
    } as unknown as CachedEstimate["estimate"],
  };
}

afterEach(() => clearEstimateCache());

describe("loadEstimateCache", () => {
  it("round-trips a well-formed entry", () => {
    saveEstimateCache(validEntry());
    const got = loadEstimateCache("azure");
    expect(got?.estimate.totals.expected).toBe(42.5);
  });

  it("returns null for a provider mismatch (single-slot cache)", () => {
    saveEstimateCache(validEntry());
    expect(loadEstimateCache("aws")).toBeNull();
  });

  it("EDGE: persistence drift — a non-finite total fails closed to a cache miss", () => {
    // Simulate an entry from an older/broken build: totals.expected is a string.
    const drifted = validEntry();
    (drifted.estimate.totals as Record<string, unknown>).expected = "NaN-as-text";
    localStorage.setItem(KEY, JSON.stringify(drifted));
    expect(loadEstimateCache("azure")).toBeNull();
  });

  it("EDGE: a NaN total fails closed (would render $NaN otherwise)", () => {
    const drifted = validEntry();
    (drifted.estimate.totals as Record<string, unknown>).expected = Number.NaN;
    // JSON.stringify turns NaN into null, which is also non-finite — both paths
    // must fail closed. Write the raw shape to be explicit about it.
    localStorage.setItem(KEY, JSON.stringify(drifted));
    expect(loadEstimateCache("azure")).toBeNull();
  });

  it("EDGE: a non-array lineItems fails closed (UI maps over it)", () => {
    const drifted = validEntry();
    (drifted.estimate as Record<string, unknown>).lineItems = { not: "an array" };
    localStorage.setItem(KEY, JSON.stringify(drifted));
    expect(loadEstimateCache("azure")).toBeNull();
  });

  it("EDGE: a missing totals object fails closed", () => {
    const drifted = validEntry();
    delete (drifted.estimate as Record<string, unknown>).totals;
    localStorage.setItem(KEY, JSON.stringify(drifted));
    expect(loadEstimateCache("azure")).toBeNull();
  });

  it("EDGE: malformed JSON fails closed", () => {
    localStorage.setItem(KEY, "{not valid json");
    expect(loadEstimateCache("azure")).toBeNull();
  });

  it("EDGE: missing top-level keys fails closed", () => {
    localStorage.setItem(KEY, JSON.stringify({ provider: "azure" }));
    expect(loadEstimateCache("azure")).toBeNull();
  });
});
