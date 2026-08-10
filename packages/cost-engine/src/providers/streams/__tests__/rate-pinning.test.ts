/**
 * Package 13 — golden freeze with real stream estimator (shared streams suite).
 */
import { describe, expect, it } from "vitest";
import type { EstimateInputs, RateCard } from "../../../core/models/estimate.types.ts";
import {
  freezeEstimate,
  loadFrozenEstimate,
  rateCardFromFreeze,
  totalsWithinTolerance,
} from "../../../core/rate-pinning.ts";
import { estimateAzureAuditStream } from "../../azure/azure-stream-estimator.ts";

const baseRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "eh-standard-tu": 0.03,
    "eh-standard-ingress-events": 0.028,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

/**
 * Fixed clock so this test doesn't rot: `freezeEstimate` fails closed once
 * `capturedAt` crosses STALE_DAYS_CRITICAL (core/rates/age-days.ts), which would
 * otherwise make this test fail ~30 days after the hardcoded date above,
 * independent of the stream-estimator logic actually under test.
 */
const FIXTURE_NOW = new Date("2026-07-01T12:00:00.000Z");

const streamInputs = {
  enabled: true,
  region: "eastus",
  ingressGBPerDay: 10,
  peakMBps: 1,
  peakEventsPerSec: 1000,
  monthHours: 730,
};

describe("package 13 — TEST golden stream freeze", () => {
  it("freeze → mutate mock rates → re-estimate from frozen payload → totals unchanged", () => {
    const first = estimateAzureAuditStream(streamInputs, baseRates);
    const estimateInputs: EstimateInputs = {
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
    };
    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: first.lineItems,
        totals: first.totals,
        confidence: first.confidence,
      },
      rateCard: baseRates,
      inputs: estimateInputs,
      now: FIXTURE_NOW,
    });

    const mutated: RateCard = {
      ...baseRates,
      unitPrices: {
        "eh-standard-tu": 1.5,
        "eh-standard-ingress-events": 1.5,
      },
    };
    const fromLive = estimateAzureAuditStream(streamInputs, mutated);
    expect(
      totalsWithinTolerance(fromLive.totals.expected, first.totals.expected),
    ).toBe(false);

    const loaded = loadFrozenEstimate(JSON.stringify(frozen));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const pinned = rateCardFromFreeze(loaded.payload);
    const replay = estimateAzureAuditStream(streamInputs, pinned);
    expect(
      totalsWithinTolerance(replay.totals.expected, frozen.totals.expected),
    ).toBe(true);
  });
});
