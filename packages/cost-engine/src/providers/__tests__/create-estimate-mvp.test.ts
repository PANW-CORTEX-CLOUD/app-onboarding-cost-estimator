/**
 * Package 19 — createEstimate Low-confidence bands + discovery $0.
 */
import { describe, expect, it } from "vitest";
import { createEstimate } from "../create-estimate.ts";
import { DSPM_BAND_HIGH_FACTOR, DSPM_BAND_LOW_FACTOR } from "../dspm/dspm.types.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";

/**
 * Offline rate seam. These assertions are all structural — discovery is $0,
 * a Low-confidence mix exposes bands, an audit line carries no SaaS — so they
 * must not depend on what the live price APIs return today, or on the network
 * being reachable at all. Without this, every call fell through to a live
 * `getRates` fetch and the suite flaked under load (a 5s timeout on the
 * discovery-only case, which does no pricing math whatsoever). Pin the clock
 * too so rate-provenance ages are deterministic.
 */
const NOW = new Date("2026-08-11T00:00:00.000Z");
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  },
  cache: createRatesCache(),
};

describe("package 19 — createEstimate MVP bands", () => {
  it("discovery-only yields $0 expected and no line items", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { discovery: true },
      volume: { accountCount: 10 },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
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
      ratesOptions: OFFLINE_RATES,
      now: NOW,
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
      ratesOptions: OFFLINE_RATES,
      now: NOW,
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
      ratesOptions: OFFLINE_RATES,
      now: NOW,
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
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    expect(locked.resolvedVolume.ingressGBPerDay).toBe(10);
  });
});
