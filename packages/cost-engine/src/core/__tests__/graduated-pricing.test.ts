/**
 * REQ-3 — published price ladders, charged band by band.
 *
 * The ladders here are the real ones, read from the vendors' own machine-
 * readable feeds (Azure `tierMinimumUnits`, AWS `beginRange`), so these tests
 * double as a record of what those feeds said on 2026-08-10.
 */
import { describe, expect, it } from "vitest";
import {
  assertValidTiers,
  blendedUnitPrice,
  describeBands,
  graduatedCost,
  withoutFreeTier,
  type PriceTier,
} from "../graduated-pricing.ts";

/** Azure Retail: Hot LRS Data Stored, Blob Storage, eastus. */
const AZURE_BLOB: PriceTier[] = [
  { fromUnits: 0, unitPrice: 0.0208 },
  { fromUnits: 51_200, unitPrice: 0.019968 },
  { fromUnits: 512_000, unitPrice: 0.019136 },
];

/** AWS Price List: TimedStorage-ByteHrs, us-east-1. */
const S3_STANDARD: PriceTier[] = [
  { fromUnits: 0, unitPrice: 0.023 },
  { fromUnits: 51_200, unitPrice: 0.022 },
  { fromUnits: 512_000, unitPrice: 0.021 },
];

/** Azure Retail: Standard Data Transfer Out — note the $0 band at 0. */
const AZURE_EGRESS: PriceTier[] = [
  { fromUnits: 0, unitPrice: 0 },
  { fromUnits: 100, unitPrice: 0.087 },
  { fromUnits: 10_335, unitPrice: 0.083 },
  { fromUnits: 51_295, unitPrice: 0.07 },
  { fromUnits: 153_695, unitPrice: 0.05 },
];

describe("charging each band at its own rate", () => {
  it("a quantity inside the first band is just that band", () => {
    const r = graduatedCost(1_000, AZURE_BLOB);
    expect(r.amount).toBeCloseTo(1_000 * 0.0208, 10);
    expect(r.bands).toHaveLength(1);
  });

  it("a quantity spanning two bands charges each at its own rate", () => {
    // 100,000 GB = 51,200 @ 0.0208 + 48,800 @ 0.019968
    const r = graduatedCost(100_000, AZURE_BLOB);
    const expected = 51_200 * 0.0208 + 48_800 * 0.019968;
    expect(r.amount).toBeCloseTo(expected, 8);
    expect(r.bands.map((b) => b.units)).toStrictEqual([51_200, 48_800]);
  });

  it("spanning all three bands", () => {
    const r = graduatedCost(600_000, S3_STANDARD);
    const expected =
      51_200 * 0.023 + (512_000 - 51_200) * 0.022 + (600_000 - 512_000) * 0.021;
    expect(r.amount).toBeCloseTo(expected, 8);
    expect(r.bands).toHaveLength(3);
  });

  it("is always cheaper than charging the first-tier rate throughout", () => {
    // This is the defect being fixed: the old model billed 600,000 × 0.023.
    const old = 600_000 * 0.023;
    expect(graduatedCost(600_000, S3_STANDARD).amount).toBeLessThan(old);
  });

  it("EDGE: exactly on a boundary stays in the lower band and does not double count", () => {
    const r = graduatedCost(51_200, AZURE_BLOB);
    expect(r.bands).toHaveLength(1);
    expect(r.amount).toBeCloseTo(51_200 * 0.0208, 8);

    // One unit past the boundary opens the next band with exactly one unit.
    const past = graduatedCost(51_201, AZURE_BLOB);
    expect(past.bands).toHaveLength(2);
    expect(past.bands[1]!.units).toBe(1);
  });

  it("EDGE: zero costs nothing and touches no band", () => {
    const r = graduatedCost(0, AZURE_BLOB);
    expect(r.amount).toBe(0);
    expect(r.bands).toStrictEqual([]);
    expect(describeBands(r)).toBe("no billable units");
  });

  it("EDGE: a single-tier ladder behaves like a flat rate", () => {
    const flat: PriceTier[] = [{ fromUnits: 0, unitPrice: 0.022 }];
    expect(graduatedCost(12_345, flat).amount).toBeCloseTo(12_345 * 0.022, 10);
  });

  it("EDGE: fractional quantities are handled exactly", () => {
    const r = graduatedCost(51_200.5, AZURE_BLOB);
    expect(r.bands[1]!.units).toBeCloseTo(0.5, 10);
  });

  it("EDGE: a negative or non-finite quantity is rejected, not coerced", () => {
    expect(() => graduatedCost(-1, AZURE_BLOB)).toThrow(/non-negative/);
    expect(() => graduatedCost(Number.NaN, AZURE_BLOB)).toThrow(/non-negative/);
    expect(() => graduatedCost(Number.POSITIVE_INFINITY, AZURE_BLOB)).toThrow(
      /non-negative/,
    );
  });
});

describe("a malformed ladder fails loudly rather than pricing wrongly", () => {
  it("rejects an empty ladder", () => {
    expect(() => assertValidTiers([])).toThrow(/at least one tier/);
  });

  it("rejects a ladder that does not start at zero", () => {
    expect(() =>
      assertValidTiers([{ fromUnits: 100, unitPrice: 0.09 }]),
    ).toThrow(/must start at 0/);
  });

  it("EDGE: rejects unsorted or duplicated boundaries", () => {
    expect(() =>
      assertValidTiers([
        { fromUnits: 0, unitPrice: 0.09 },
        { fromUnits: 500, unitPrice: 0.08 },
        { fromUnits: 500, unitPrice: 0.07 },
      ]),
    ).toThrow(/strictly increase/);
    expect(() =>
      assertValidTiers([
        { fromUnits: 0, unitPrice: 0.09 },
        { fromUnits: 500, unitPrice: 0.08 },
        { fromUnits: 100, unitPrice: 0.07 },
      ]),
    ).toThrow(/strictly increase/);
  });

  it("rejects a negative price", () => {
    expect(() =>
      assertValidTiers([
        { fromUnits: 0, unitPrice: 0.09 },
        { fromUnits: 100, unitPrice: -1 },
      ]),
    ).toThrow(/invalid unitPrice/);
  });
});

describe("free allowances are opt-in", () => {
  it("honouring the published ladder makes the first 100 GB free", () => {
    const r = graduatedCost(1_000, AZURE_EGRESS);
    expect(r.amount).toBeCloseTo(900 * 0.087, 10);
  });

  it("dropping the free band re-prices those units at the first paid rate", () => {
    const paid = withoutFreeTier(AZURE_EGRESS);
    expect(paid[0]!.unitPrice).toBe(0.087);
    expect(graduatedCost(1_000, paid).amount).toBeCloseTo(1_000 * 0.087, 10);
  });

  it("dropping the free band leaves every published boundary untouched", () => {
    // The vendor bills against those boundaries whoever consumed the allowance,
    // so only the free band's price may change.
    expect(withoutFreeTier(AZURE_EGRESS).map((t) => t.fromUnits)).toStrictEqual(
      AZURE_EGRESS.map((t) => t.fromUnits),
    );
  });

  it("EDGE: a ladder with no free band is returned unchanged", () => {
    expect(withoutFreeTier(S3_STANDARD)).toStrictEqual(S3_STANDARD);
  });

  it("EDGE: an entirely free ladder is left alone rather than invented into a price", () => {
    const allFree: PriceTier[] = [{ fromUnits: 0, unitPrice: 0 }];
    expect(withoutFreeTier(allFree)).toStrictEqual(allFree);
    expect(graduatedCost(500, allFree).amount).toBe(0);
  });

  it("conservative default costs more than honouring the allowance", () => {
    const withAllowance = graduatedCost(1_000, AZURE_EGRESS).amount;
    const without = graduatedCost(1_000, withoutFreeTier(AZURE_EGRESS)).amount;
    expect(without).toBeGreaterThan(withAllowance);
  });
});

describe("reporting", () => {
  it("blended rate sits between the bands it spans", () => {
    const blended = blendedUnitPrice(100_000, AZURE_BLOB);
    expect(blended).toBeLessThan(0.0208);
    expect(blended).toBeGreaterThan(0.019968);
  });

  it("EDGE: blended rate of zero quantity reports the first tier, not NaN", () => {
    expect(blendedUnitPrice(0, AZURE_BLOB)).toBe(0.0208);
  });

  it("band description names units, rate and boundaries", () => {
    const text = describeBands(graduatedCost(100_000, AZURE_BLOB));
    expect(text).toMatch(/51,200 units @ \$0\.0208/);
    expect(text).toMatch(/48,800 units @ \$0\.019968/);
    expect(text).toMatch(/\(51,200–512,000\)/);
  });
});
