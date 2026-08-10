/**
 * Unit tests for client-side volume elasticity preview (mirrors cost-engine).
 */
import { describe, expect, it } from "vitest";
import { deriveVolumeFromAccounts } from "../shared/lib/volume-elasticity.ts";

describe("volume elasticity + estimate errors", () => {
  it("accountCount 1000 scales medium baseline ×100", () => {
    const v = deriveVolumeFromAccounts(1000, 0);
    expect(v.ingressGBPerDay).toBe(1000);
    expect(v.peakMBps).toBe(100);
    expect(v.peakEventsPerSec).toBe(100_000);
  });

  it("accountCount <= 0 fails closed", () => {
    expect(() => deriveVolumeFromAccounts(0)).toThrow(/accountCount/);
  });
});
