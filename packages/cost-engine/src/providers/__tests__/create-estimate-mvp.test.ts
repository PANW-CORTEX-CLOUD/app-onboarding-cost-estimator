/**
 * Package 19 — createEstimate Low-confidence bands + discovery $0.
 */
import { describe, expect, it } from "vitest";
import { createEstimate } from "../create-estimate.ts";
import { DSPM_BAND_HIGH_FACTOR, DSPM_BAND_LOW_FACTOR } from "../dspm/dspm.types.ts";

describe("package 19 — createEstimate MVP bands", () => {
  it("discovery-only yields $0 expected and no line items", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { discovery: true },
      volume: { accountCount: 10 },
    });
    expect(r.lineItems).toEqual([]);
    expect(r.totals.expected).toBe(0);
    expect(r.warnings.some((w) => /discovery/i.test(w))).toBe(true);
  });

  it("Low-confidence (DSPM) exposes low/expected/high bands", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { dspm: true },
      volume: {
        accountCount: 10,
        dataEstateGB: 1000,
        pctScanned: 10,
        scansPerMonth: 1,
      },
    });
    expect(r.confidence).toBe("Low");
    expect(r.totals.low).toBeDefined();
    expect(r.totals.high).toBeDefined();
    expect(r.totals.low!).toBeCloseTo(
      r.totals.expected * DSPM_BAND_LOW_FACTOR,
      5,
    );
    expect(r.totals.high!).toBeCloseTo(
      r.totals.expected * DSPM_BAND_HIGH_FACTOR,
      5,
    );
  });

  it("audit-only has no SaaS line items", async () => {
    const r = await createEstimate({
      provider: "aws",
      region: "us-east-1",
      capabilities: { auditLogs: true },
      volume: {
        accountCount: 10,
        overrideStreamMetrics: true,
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
      },
    });
    expect(r.lineItems.length).toBeGreaterThan(0);
    for (const li of r.lineItems) {
      expect(li.capability).not.toMatch(/saas|license/i);
      expect(li.meterId).not.toMatch(/saas|license/i);
    }
    const put = r.lineItems.find((l) => l.meterId === "kinesis-put-payload-units");
    expect(put?.amount).toBeLessThan(1);
    expect(r.totals.expected).toBeLessThan(100);
  });

  it("accountCount elasticities apply unless overrideStreamMetrics", async () => {
    const scaled = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: {
        accountCount: 100,
        // stale UI defaults must not lock stream volume
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
      },
    });
    expect(scaled.resolvedVolume.overrideStreamMetrics).toBe(false);
    expect(scaled.resolvedVolume.ingressGBPerDay).toBeCloseTo(100);
    const locked = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: {
        accountCount: 100,
        overrideStreamMetrics: true,
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
      },
    });
    expect(locked.resolvedVolume.ingressGBPerDay).toBe(10);
  });
});
