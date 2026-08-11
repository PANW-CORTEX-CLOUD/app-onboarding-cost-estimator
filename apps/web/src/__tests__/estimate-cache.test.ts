/**
 * estimate-cache persistence + drift guard (REQ-18).
 *
 * The cache is a fail-closed recovery slot, so the one behaviour that matters
 * beyond a plain round-trip is that a blob which parses but no longer matches
 * the current `EstimateResponse` shape is treated as absent rather than
 * rendered — otherwise a stale build's estimate could surface through a schema
 * change with missing/renamed fields.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  saveEstimateCache,
  loadEstimateCache,
  clearEstimateCache,
  type CachedEstimate,
} from "../shared/lib/estimate-cache.ts";

function validEntry(provider: "azure" | "aws" | "gcp" = "azure"): CachedEstimate {
  return {
    provider,
    cachedAt: "2026-08-11T00:00:00.000Z",
    // Minimal but shape-complete EstimateResponse.
    estimate: {
      provider,
      lineItems: [],
      totals: { expected: 12.34 },
      confidence: "High",
      modelVersion: "0.1.3",
      ratesAsOf: "2026-08-11T00:00:00.000Z",
      inputHash: "abcd1234",
    } as CachedEstimate["estimate"],
  };
}

describe("estimate-cache", () => {
  beforeEach(() => clearEstimateCache());

  it("round-trips a valid entry", () => {
    saveEstimateCache(validEntry("azure"));
    const got = loadEstimateCache("azure");
    expect(got?.provider).toBe("azure");
    expect(got?.estimate.totals.expected).toBe(12.34);
  });

  it("treats a provider mismatch as absent", () => {
    saveEstimateCache(validEntry("azure"));
    expect(loadEstimateCache("aws")).toBeNull();
    // No provider filter → still returns the entry.
    expect(loadEstimateCache()?.provider).toBe("azure");
  });

  it("returns null for a corrupt (unparseable) blob", () => {
    localStorage.setItem("cloud-connector:last-estimate:v1", "{not json");
    expect(loadEstimateCache()).toBeNull();
  });

  it("EDGE: fails closed on shape drift — a parseable blob missing required fields is ignored", () => {
    // Simulate a blob written by an older build whose EstimateResponse lacked
    // today's required fields (here: no `totals`, no `modelVersion`). It parses
    // and has provider/estimate/cachedAt, so the old presence-only check would
    // have returned it; the shape guard must reject it.
    const drifted = {
      provider: "azure",
      cachedAt: "2026-01-01T00:00:00.000Z",
      estimate: {
        provider: "azure",
        lineItems: [],
        // totals, confidence, modelVersion, ratesAsOf, inputHash all missing
      },
    };
    localStorage.setItem(
      "cloud-connector:last-estimate:v1",
      JSON.stringify(drifted),
    );
    expect(loadEstimateCache("azure")).toBeNull();
  });

  it("EDGE: rejects a blob whose totals.expected is the wrong type", () => {
    const bad = validEntry("gcp");
    // Corrupt just the load-bearing numeric field.
    (bad.estimate.totals as { expected: unknown }).expected = "not-a-number";
    saveEstimateCache(bad);
    expect(loadEstimateCache("gcp")).toBeNull();
  });
});
