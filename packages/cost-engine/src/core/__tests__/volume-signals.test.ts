/**
 * Package 12 — volume signals elasticities, raw paste (core only).
 * BYO × stream estimators live under providers/streams/__tests__.
 */
import { describe, expect, it } from "vitest";
import {
  LOG_CATEGORY_SETS,
  REFERENCE_ACCOUNT_COUNT,
  parseRawStreamMetrics,
  resolveVolumeSignals,
} from "../volume-signals.ts";

describe("package 12 — REQ universal volume inputs", () => {
  it("resolves accounts, intensity, MAU, BYO flags", () => {
    const r = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      monthlyActiveUsers: 10_000,
      logIntensity: "medium",
      orgPreset: "medium",
      byoManagedStream: true,
    });
    expect(r.byoManagedStream).toBe(true);
    expect(r.zeroManagedStreamCapacity).toBe(true);
    expect(r.accountScale).toBe(1);
    expect(r.ingressGBPerDay).toBeGreaterThan(0);
  });
});

describe("package 12 — AC elasticities", () => {
  it("account/project counts scale ingress and peak", () => {
    const base = resolveVolumeSignals({
      provider: "aws",
      accountCount: REFERENCE_ACCOUNT_COUNT,
      orgPreset: "medium",
    });
    const scaled = resolveVolumeSignals({
      provider: "aws",
      accountCount: REFERENCE_ACCOUNT_COUNT * 10,
      orgPreset: "medium",
    });
    expect(scaled.ingressGBPerDay).toBeCloseTo(base.ingressGBPerDay * 10);
    expect(scaled.peakMBps).toBeCloseTo(base.peakMBps * 10);
    expect(scaled.peakEventsPerSec).toBeCloseTo(base.peakEventsPerSec * 10);
  });
});

describe("package 12 — TEST", () => {
  it("10× account scale increases log ingress", () => {
    const a = resolveVolumeSignals({
      provider: "gcp",
      accountCount: 10,
      orgPreset: "small",
    });
    const b = resolveVolumeSignals({
      provider: "gcp",
      accountCount: 100,
      orgPreset: "small",
    });
    expect(b.ingressGBPerDay / a.ingressGBPerDay).toBeCloseTo(10);
  });

  it("raw metric paste overrides presets", () => {
    const r = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      orgPreset: "large",
      rawMetrics: {
        ingressGBPerDay: 3,
        peakMBps: 0.5,
        peakEventsPerSec: 100,
      },
    });
    expect(r.ingressGBPerDay).toBe(3);
    expect(r.peakMBps).toBe(0.5);
    expect(r.peakEventsPerSec).toBe(100);
  });

  it("raw paste string form works", () => {
    const r = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      rawMetrics: "ingressGBPerDay=7,peakMBps=2",
    });
    expect(r.ingressGBPerDay).toBe(7);
    expect(r.peakMBps).toBe(2);
  });
});

describe("package 12 — EDGE", () => {
  it("provider log category multipliers", () => {
    expect(LOG_CATEGORY_SETS.azure.categories).toBe(8);
    expect(LOG_CATEGORY_SETS.aws.categories).toBe(2);
    expect(LOG_CATEGORY_SETS.gcp.categories).toBe(3);
    const full = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      enabledLogCategories: 8,
    });
    const half = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      enabledLogCategories: 4,
    });
    expect(half.ingressGBPerDay).toBeCloseTo(full.ingressGBPerDay * 0.5);
  });

  it("invalid raw metric paste rejected", () => {
    expect(() => parseRawStreamMetrics("")).toThrow(/invalid raw metric paste/i);
    expect(() => parseRawStreamMetrics("{not json")).toThrow(/malformed JSON/i);
    expect(() => parseRawStreamMetrics("foo=bar")).toThrow(/cannot parse|unknown/i);
    expect(() =>
      parseRawStreamMetrics({ ingressGBPerDay: -1 }),
    ).toThrow(/non-negative/i);
  });

  it("accountCount <= 0 fails closed", () => {
    expect(() =>
      resolveVolumeSignals({ provider: "azure", accountCount: 0 }),
    ).toThrow(/accountCount/);
  });
});
