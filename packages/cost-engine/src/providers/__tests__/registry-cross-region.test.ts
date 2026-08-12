/**
 * REQ-19 — registry cross-region pull is reachable end-to-end, and `avgImageGB`
 * is load-bearing exactly when it should be.
 *
 * The registry estimator core has always modeled cross-region pull
 * (`amount = crossRegionPull ? imageCount × avgImageGB × scansPerMonth × rate : 0`),
 * but `createEstimate` hard-wired `crossRegionPull: false`, so the whole path
 * was unreachable and `avgImageGB` changed no total. These tests exercise the
 * request → engine threading and the "default only when it matters" rule for
 * the `avgImageGB` assumption, so the field can never silently price at $0
 * (the REQ-6.2 multiplicand trap) nor report an assumption it never used.
 */
import { describe, expect, it } from "vitest";
import { createEstimate } from "../create-estimate.ts";
import { DEFAULT_AVG_IMAGE_GB } from "../../core/estimator-defaults.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  },
  cache: createRatesCache(),
};
// Fallback azure-egress-gb first-tier rate (the meter registry pull bills).
const AZURE_EGRESS_RATE = 0.087;

function registryLineOf(lineItems: { capability: string; amount: number }[]) {
  return lineItems.find((li) => li.capability === "registry");
}

describe("REQ-19 — registry cross-region pull threading", () => {
  it("cross-region pull bills imageCount × avgImageGB × scansPerMonth on the egress meter", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { registry: true },
      volume: {
        imageCount: 100,
        avgImageGB: 2,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    const reg = registryLineOf(r.lineItems);
    expect(reg).toBeDefined();
    // pullGb = 100 × 2 × 1 = 200; amount = 200 × 0.087
    expect(reg!.amount).toBeCloseTo(200 * AZURE_EGRESS_RATE, 6);
  });

  it("same-region pull (crossRegionPull omitted) prices the registry line at $0", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { registry: true },
      volume: { imageCount: 100, avgImageGB: 2, scansPerMonth: 1 },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    const reg = registryLineOf(r.lineItems);
    expect(reg).toBeDefined();
    expect(reg!.amount).toBe(0);
  });

  it("cross-region pull with avgImageGB omitted applies the tracked default (never a silent $0)", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { registry: true },
      // No avgImageGB — the cross-region line must not collapse to $0.
      volume: { imageCount: 100, scansPerMonth: 1, crossRegionPull: true },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    const reg = registryLineOf(r.lineItems);
    // pullGb = 100 × DEFAULT_AVG_IMAGE_GB × 1
    expect(reg!.amount).toBeCloseTo(
      100 * DEFAULT_AVG_IMAGE_GB * AZURE_EGRESS_RATE,
      6,
    );
    const applied = r.appliedDefaults.find(
      (d) => d.field === "volume.avgImageGB",
    );
    expect(applied).toBeDefined();
    expect(applied!.kind).toBe("assumption");
    expect(applied!.value).toBe(DEFAULT_AVG_IMAGE_GB);
  });

  it("EDGE: same-region pull does not default or report avgImageGB — it changed no total", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { registry: true },
      // avgImageGB omitted AND crossRegionPull off → the field is inert.
      volume: { imageCount: 100, scansPerMonth: 1 },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    const applied = r.appliedDefaults.find(
      (d) => d.field === "volume.avgImageGB",
    );
    // Reporting an assumption the estimate never used would be dishonest.
    expect(applied).toBeUndefined();
  });

  it("EDGE: cross-region pull with an explicit avgImageGB=0 is the operator's decision — $0, no default", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { registry: true },
      volume: {
        imageCount: 100,
        avgImageGB: 0,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    const reg = registryLineOf(r.lineItems);
    expect(reg!.amount).toBe(0);
    // An explicit 0 is a choice, not an omission — no default substituted.
    const applied = r.appliedDefaults.find(
      (d) => d.field === "volume.avgImageGB",
    );
    expect(applied).toBeUndefined();
  });
});
