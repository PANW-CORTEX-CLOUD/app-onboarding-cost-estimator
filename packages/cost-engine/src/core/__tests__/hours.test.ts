/**
 * Package 05 — hours & calendar convention REQ/AC/TEST/EDGE.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MONTH_HOURS,
  MONTH_HOURS_31_DAY,
  applyPeakFactor,
  daysInMonth,
  isLeapYear,
  labelForMonthHours,
  prorateSnapshotCost,
  resolveMonthHours,
  scaleHourlyCost,
  splitAverageAndPeakCost,
} from "../hours.ts";

describe("package 05 — REQ defaults & conventions", () => {
  it("locks default monthHours to 730", () => {
    expect(DEFAULT_MONTH_HOURS).toBe(730);
    expect(resolveMonthHours().monthHours).toBe(730);
    expect(resolveMonthHours().convention).toBe("730");
  });

  it("supports 744 and actual daysInMonth conventions", () => {
    expect(resolveMonthHours({ convention: "744" }).monthHours).toBe(744);
    const feb2025 = resolveMonthHours({
      convention: "actual",
      year: 2025,
      month: 2,
    });
    expect(feb2025.daysInMonth).toBe(28);
    expect(feb2025.monthHours).toBe(28 * 24);
  });

  it("peak factor is separate from average volume", () => {
    const r = applyPeakFactor({ averageVolume: 1000, peakFactor: 2 });
    expect(r.averageVolume).toBe(1000);
    expect(r.peakThroughputRecommendation).toBe(2000);
    expect(r.averageUtilizationCostRatio).toBe(1);
    expect(r.peakCapacityCostRatio).toBe(2);
  });
});

describe("package 05 — AC linear scale + labels", () => {
  it("changing monthHours linearly scales hourly billing", () => {
    const rate = 0.03;
    const units = 1;
    const c730 = scaleHourlyCost(units, rate, 730);
    const c744 = scaleHourlyCost(units, rate, 744);
    expect(c730).toBeCloseTo(1 * rate * 730);
    expect(c744).toBeCloseTo(1 * rate * 744);
    expect(c744 / c730).toBeCloseTo(744 / 730);
  });

  it("changing monthHours linearly scales prorated snapshot costs", () => {
    const gb = 100;
    const price = 0.05;
    const life = 24;
    const p730 = prorateSnapshotCost(gb, price, life, 730);
    const p744 = prorateSnapshotCost(gb, price, life, 744);
    // cost ∝ 1/monthHours
    expect(p730 / p744).toBeCloseTo(744 / 730);
  });

  it("exposes UI/API labels for active convention", () => {
    expect(resolveMonthHours().label).toMatch(/730.*industry average/i);
    expect(resolveMonthHours({ convention: "744" }).label).toMatch(
      /744.*31-day/i,
    );
    expect(
      resolveMonthHours({ convention: "actual", year: 2024, month: 2 }).label,
    ).toMatch(/696.*actual/i);
    expect(labelForMonthHours("730", 730)).toContain("industry average");
  });
});

describe("package 05 — TEST golden + Feb + peak", () => {
  it("1 unit × rate × 730 vs 744 golden", () => {
    const rate = 1.0;
    expect(scaleHourlyCost(1, rate, 730)).toBe(730);
    expect(scaleHourlyCost(1, rate, 744)).toBe(744);
    expect(MONTH_HOURS_31_DAY).toBe(744);
  });

  it("Feb 28 / 29 actual days option", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(
      resolveMonthHours({ convention: "actual", year: 2025, month: 2 })
        .monthHours,
    ).toBe(672);
    expect(
      resolveMonthHours({ convention: "actual", year: 2024, month: 2 })
        .monthHours,
    ).toBe(696);
  });

  it("peak factor doubles throughput recommendation without multiplying base event volume", () => {
    const base = 500;
    const r = applyPeakFactor({ averageVolume: base, peakFactor: 2 });
    expect(r.averageVolume).toBe(base);
    expect(r.peakThroughputRecommendation).toBe(base * 2);
  });
});

describe("package 05 — EDGE", () => {
  it("supports leap years", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
  });

  it("does not silently use 720", () => {
    expect(resolveMonthHours().monthHours).not.toBe(720);
    expect(() => resolveMonthHours({ monthHours: 720 })).toThrow(/720/);
  });

  it("auto-inflate peak throughput cost is separate from average utilization cost", () => {
    const split = splitAverageAndPeakCost({
      averageUtilizationCost: 100,
      peakFactor: 2,
    });
    expect(split.averageCost).toBe(100);
    expect(split.peakUpliftCost).toBe(100);
    expect(split.totalCost).toBe(200);
    // average line unchanged when inspecting averageCost alone
    expect(split.averageCost).toBe(100);
  });

  it("actual convention requires year+month (fail closed)", () => {
    expect(() => resolveMonthHours({ convention: "actual" })).toThrow(
      /year and month/,
    );
  });

  it("peakFactor < 1 fails closed", () => {
    expect(() =>
      applyPeakFactor({ averageVolume: 10, peakFactor: 0.5 }),
    ).toThrow(/peakFactor/);
  });
});
