/**
 * Package 27 — cost driver aggregation tests.
 */
import { describe, expect, it } from "vitest";
import { aggregateCostDrivers } from "../cost-drivers.ts";

describe("aggregateCostDrivers", () => {
  it("sums by capability and percent ~100", () => {
    const estimate = {
      totals: { expected: 100 },
      lineItems: [
        { capability: "audit_logs", amount: 60, confidence: "High" },
        { capability: "audit_logs", amount: 10, confidence: "Med" },
        { capability: "dspm", amount: 30, confidence: "Low" },
      ],
    };
    const drivers = aggregateCostDrivers(estimate as never);
    expect(drivers.length).toBe(2);
    const sum = drivers.reduce((s, d) => s + d.percent, 0);
    expect(sum).toBeGreaterThan(99);
    expect(sum).toBeLessThan(101);
    expect(drivers[0].capability).toBe("audit_logs");
    expect(drivers[0].confidence).toBe("Med");
  });

  it("empty estimate returns []", () => {
    expect(aggregateCostDrivers(null)).toEqual([]);
  });

  it("single cap is 100%", () => {
    const drivers = aggregateCostDrivers({
      totals: { expected: 50 },
      lineItems: [{ capability: "registry", amount: 50, confidence: "Low" }],
    } as never);
    expect(drivers[0].percent).toBe(100);
  });
});
