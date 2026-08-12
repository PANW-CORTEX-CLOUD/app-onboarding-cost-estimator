/**
 * Package 15 + 20 — projectCosts core tests.
 */
import { describe, expect, it } from "vitest";
import {
  projectCosts,
  PROJECTION_MAX_MONTHS,
  PROJECTION_MAX_LINE_ITEMS,
  steppedCapacityMultiplier,
  volumeGrowthFactor,
} from "../project-costs.ts";

describe("package 15/20 — projectCosts", () => {
  it("0% growth is flat = monthly estimate each month (AC)", () => {
    const r = projectCosts({
      monthlyExpected: 100,
      months: 3,
      annualGrowthPercent: 0,
    });
    expect(r.series.map((p) => p.expected)).toEqual([100, 100, 100]);
    expect(r.series[0]!.cumulative).toBe(100);
    expect(r.series[1]!.cumulative).toBe(200);
    expect(r.series[2]!.cumulative).toBe(300);
    expect(r.table).toEqual(r.series);
    expect(r.total).toBe(300);
    expect(r.monthlyBaseline).toBe(100);
    expect(r.disclaimer).toMatch(/does not imply reserved/i);
  });

  it("cumulative[m] = sum(expected[0..m]) (TEST)", () => {
    const r = projectCosts({
      monthlyExpected: 10,
      months: 4,
      annualGrowthPercent: 0,
    });
    let sum = 0;
    for (const p of r.series) {
      sum += p.expected;
      expect(p.cumulative).toBeCloseTo(sum);
    }
    expect(r.total).toBeCloseTo(sum);
  });

  it("positive growth compounds monthly", () => {
    const r = projectCosts({
      monthlyExpected: 100,
      months: 2,
      annualGrowthPercent: 12,
    });
    expect(r.series[0]!.expected).toBeCloseTo(100);
    expect(r.series[1]!.expected).toBeGreaterThan(100);
    expect(r.series[1]!.volumeIndex).toBeGreaterThan(1);
  });

  it("volumeElastic meters grow; non-elastic stay flat", () => {
    const r = projectCosts({
      monthlyExpected: 150,
      months: 2,
      annualGrowthPercent: 100,
      lineItems: [
        {
          provider: "azure",
          capability: "auditLogs",
          meterId: "eh-standard-ingress-events",
          amount: 100,
          confidence: "Med",
          volumeElastic: true,
        },
        {
          provider: "azure",
          capability: "adsCloud",
          meterId: "vm-outpost-scanner",
          amount: 50,
          confidence: "High",
          volumeElastic: false,
        },
      ],
    });
    expect(r.series[0]!.expected).toBeCloseTo(150);
    const m2 = r.series[1]!;
    const ingress = m2.stacks!.find((s) => s.meterId === "eh-standard-ingress-events")!;
    const ads = m2.stacks!.find((s) => s.meterId === "vm-outpost-scanner")!;
    expect(ingress.amount).toBeGreaterThan(100);
    expect(ads.amount).toBe(50);
  });

  it("TU / Kinesis / PubSub use step functions (TEST)", () => {
    expect(steppedCapacityMultiplier(1)).toBe(1);
    expect(steppedCapacityMultiplier(1.01)).toBe(2);
    expect(steppedCapacityMultiplier(2.0)).toBe(2);
    expect(steppedCapacityMultiplier(2.1)).toBe(3);

    const r = projectCosts({
      monthlyExpected: 10,
      months: 13,
      annualGrowthPercent: 100,
      lineItems: [
        {
          provider: "aws",
          capability: "auditLogs",
          meterId: "kinesis-shard-hour",
          amount: 10,
          confidence: "Med",
          volumeElastic: true,
        },
      ],
    });
    // Month 1: 1×; when volumeIndex exceeds 1, cost steps to 2× base
    expect(r.series[0]!.expected).toBe(10);
    const late = r.series[r.series.length - 1]!;
    expect(late.expected % 10).toBe(0);
    expect(late.expected).toBeGreaterThanOrEqual(20);
    expect(late.expected).toBe(
      10 * steppedCapacityMultiplier(late.volumeIndex),
    );
  });

  it("horizon >36 rejected; negative growth floored at 0 (EDGE)", () => {
    expect(() =>
      projectCosts({ monthlyExpected: 1, months: PROJECTION_MAX_MONTHS + 1 }),
    ).toThrow(/<= 36/);
    const r = projectCosts({
      monthlyExpected: 100,
      months: 3,
      annualGrowthPercent: -50,
    });
    expect(r.annualGrowthPercent).toBe(0);
    expect(r.series.every((p) => p.expected === 100)).toBe(true);
    expect(volumeGrowthFactor(3, -50)).toBe(1);
  });

  it("fails closed on invalid inputs", () => {
    expect(() => projectCosts({ monthlyExpected: -1, months: 1 })).toThrow();
    expect(() => projectCosts({ monthlyExpected: 1, months: 0 })).toThrow();
  });

  it("low/high envelope when bands provided", () => {
    const r = projectCosts({
      monthlyExpected: 100,
      months: 2,
      annualGrowthPercent: 0,
      monthlyLow: 50,
      monthlyHigh: 200,
      lineItems: [
        {
          provider: "azure",
          capability: "dspm",
          meterId: "blob-data-read-ops",
          amount: 100,
          confidence: "Low",
        },
      ],
    });
    expect(r.series[0]!.low).toBe(50);
    expect(r.series[0]!.high).toBe(200);
  });

  describe("REQ-24 — projection hardening", () => {
    function line(amount: number) {
      return {
        provider: "azure",
        capability: "auditLogs",
        meterId: "m",
        amount,
        confidence: "High" as const,
      };
    }

    it("refuses more line items than the cap (CPU/memory amplification)", () => {
      const tooMany = Array.from({ length: PROJECTION_MAX_LINE_ITEMS + 1 }, () =>
        line(1),
      );
      expect(() =>
        projectCosts({ monthlyExpected: 100, months: 12, lineItems: tooMany }),
      ).toThrow(/exceeds/);
    });

    it("accepts exactly the cap", () => {
      const atCap = Array.from({ length: PROJECTION_MAX_LINE_ITEMS }, () =>
        line(1),
      );
      const r = projectCosts({
        monthlyExpected: 0,
        months: 1,
        lineItems: atCap,
      });
      expect(r.series[0]!.expected).toBe(PROJECTION_MAX_LINE_ITEMS);
    });

    it("fails closed on numeric overflow rather than emitting a non-finite cost", () => {
      // A finite but enormous monthly value compounded by growth overflows to
      // Infinity, which JSON.stringify would serialize as null.
      expect(() =>
        projectCosts({
          monthlyExpected: 1e308,
          months: 36,
          annualGrowthPercent: 1e300,
        }),
      ).toThrow(/overflow|not finite/i);
    });

    it("fails closed when a line-item amount overflows the total", () => {
      expect(() =>
        projectCosts({
          monthlyExpected: 100,
          months: 12,
          annualGrowthPercent: 50,
          lineItems: [line(1e308)],
        }),
      ).toThrow(/overflow|not finite/i);
    });
  });
});
