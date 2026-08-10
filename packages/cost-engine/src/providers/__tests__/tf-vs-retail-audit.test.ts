/**
 * Packages 31–33 — Azure TF audit retail, honesty warnings, audit-only allowlist.
 */
import { describe, expect, it } from "vitest";
import { createEstimate } from "../create-estimate.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import {
  AZURE_TF_AUDIT_BILLABLE_METERS,
  AZURE_AUDIT_ONLY_METER_ALLOWLIST,
  AZURE_MODELED_NO_TF_WARNING_PREFIX,
  NO_TF_INVENTORY_WARNING,
  isAzureAuditOnlyMeterAllowed,
} from "../azure/tf-audit-reconciliation.ts";
import { AZURE_TF_DEFAULTS } from "../azure/capability-meter-map.ts";
import { modelVersion } from "../../model-version.ts";
import { appendTfHonestyWarnings } from "../tf-honesty-warnings.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";

/**
 * These assert on exact meters and amounts, so rates must come from the in-repo
 * fallback rather than whatever the live price APIs answer today — otherwise
 * the suite is a network test that fails on a slow link.
 */
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true }),
    aws: createAwsRatesAdapter({ forceFallback: true }),
    gcp: createGcpRatesAdapter({ forceFallback: true }),
  },
  cache: createRatesCache(),
};

const TF_AUDIT_VOLUME = {
  accountCount: 10,
  overrideStreamMetrics: true,
  ingressGBPerDay: 10,
  peakMBps: 1,
  peakEventsPerSec: 1000,
  avgStoredGB: 1,
} as const;

describe("package 31 — Azure audit TF defaults + three meters", () => {
  it("TF audit-only estimate emits exactly the three billable meters", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { ...TF_AUDIT_VOLUME },
      ratesOptions: OFFLINE_RATES,
    });
    const ids = r.lineItems.map((l) => l.meterId).sort();
    expect(ids).toEqual([...AZURE_TF_AUDIT_BILLABLE_METERS].sort());
    expect(r.lineItems.every((l) => !/capture/i.test(l.meterId))).toBe(true);
    expect(AZURE_TF_DEFAULTS.eventHubsCapacityTu).toBe(1);
    expect(AZURE_TF_DEFAULTS.captureConfigured).toBe(false);
  });

  it("peaks at 1 MB/s + 1000 eps size to TF min 1 TU (golden)", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { ...TF_AUDIT_VOLUME },
      ratesOptions: OFFLINE_RATES,
    });
    const tu = r.lineItems.find((l) => l.meterId === "eh-standard-tu");
    expect(tu).toBeDefined();
    // 1 TU × $0.03 × 730h = 21.9
    expect(tu!.amount).toBeCloseTo(0.03 * 730, 5);
  });

  it("modelVersion bumped for TF honesty / reconciliation", () => {
    expect(modelVersion).toBe("0.1.3");
  });
});

describe("package 31 — EDGE empty retail → fallback warn", () => {
  it("empty Items uses fallback with warning (no silent $0 card)", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ Items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const r = await createAzureRatesAdapter({
      fetchImpl,
      now: new Date("2026-07-29T00:00:00.000Z"),
    }).getRates("eastus");
    expect(r.ratesSource).toBe("fallback");
    expect(r.warnings?.join(" ")).toMatch(/empty Items.*fallback/i);
    expect(Object.keys(r.rates.unitPrices).length).toBeGreaterThan(0);
    expect(r.rates.unitPrices["eh-standard-tu"]).toBeGreaterThan(0);
  });
});

describe("package 32 — TF honesty warnings", () => {
  it("Azure audit-only has no modeled/no-TF warning", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { ...TF_AUDIT_VOLUME },
      ratesOptions: OFFLINE_RATES,
    });
    expect(
      r.warnings.some((w) => w.startsWith(AZURE_MODELED_NO_TF_WARNING_PREFIX)),
    ).toBe(false);
  });

  it("Azure comprehensive lists modeled non-TF caps once", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: {
        discovery: true,
        auditLogs: true,
        adsCloud: true,
        dspm: true,
        registry: true,
        serverless: true,
        egress: true,
      },
      volume: {
        ...TF_AUDIT_VOLUME,
        dataEstateGB: 1000,
        pctScanned: 10,
        vmCount: 2,
        avgUsedDiskGB: 50,
        imageCount: 5,
        avgImageGB: 1,
        packageCount: 10,
        egressGB: 10,
        scansPerMonth: 1,
      },
      ratesOptions: OFFLINE_RATES,
    });
    const honesty = r.warnings.filter((w) =>
      w.startsWith(AZURE_MODELED_NO_TF_WARNING_PREFIX),
    );
    expect(honesty).toHaveLength(1);
    expect(honesty[0]).toMatch(/ads_cloud/);
    expect(honesty[0]).toMatch(/dspm/);
    expect(honesty[0]).toMatch(/registry/);
    expect(honesty[0]).toMatch(/serverless/);
    expect(honesty[0]).toMatch(/egress/);
  });

  it("AWS/GCP emit a single no-TF inventory note (not per-toggle spam)", async () => {
    for (const provider of ["aws", "gcp"] as const) {
      const r = await createEstimate({
        provider,
        region: provider === "aws" ? "us-east-1" : "us-central1",
        capabilities: {
          auditLogs: true,
          adsCloud: true,
          dspm: true,
          registry: true,
        },
        volume: {
          accountCount: 10,
          overrideStreamMetrics: true,
          ingressGBPerDay: 10,
          peakMBps: 1,
          peakEventsPerSec: 1000,
          dataEstateGB: 100,
          pctScanned: 10,
          vmCount: 1,
          avgUsedDiskGB: 10,
          imageCount: 1,
          avgImageGB: 1,
          scansPerMonth: 1,
        },
        ratesOptions: OFFLINE_RATES,
      });
      const notes = r.warnings.filter((w) =>
        w.includes(NO_TF_INVENTORY_WARNING),
      );
      expect(notes).toHaveLength(1);
    }
  });

  it("discovery-only still $0 and no modeled spam", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { discovery: true },
      volume: { accountCount: 5 },
      ratesOptions: OFFLINE_RATES,
    });
    expect(r.totals.expected).toBe(0);
    expect(r.lineItems).toEqual([]);
    expect(
      r.warnings.some((w) => w.startsWith(AZURE_MODELED_NO_TF_WARNING_PREFIX)),
    ).toBe(false);
  });

  it("appendTfHonestyWarnings does not duplicate", () => {
    const w: string[] = [];
    appendTfHonestyWarnings("azure", { adsCloud: true, dspm: true }, w);
    appendTfHonestyWarnings("azure", { adsCloud: true, dspm: true }, w);
    expect(w.filter((x) => x.startsWith(AZURE_MODELED_NO_TF_WARNING_PREFIX))).toHaveLength(
      1,
    );
  });
});

describe("package 33 — audit-only meter allowlist", () => {
  it("Azure audit-only breakdown ⊆ EH TU + ingress + blob capacity", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { ...TF_AUDIT_VOLUME },
      ratesOptions: OFFLINE_RATES,
    });
    for (const li of r.lineItems) {
      expect(isAzureAuditOnlyMeterAllowed(li.meterId)).toBe(true);
      expect(
        (AZURE_AUDIT_ONLY_METER_ALLOWLIST as readonly string[]).includes(
          li.meterId,
        ),
      ).toBe(true);
    }
    expect(r.lineItems.some((l) => /ads|dspm|acr|capture/i.test(l.meterId))).toBe(
      false,
    );
  });
});
