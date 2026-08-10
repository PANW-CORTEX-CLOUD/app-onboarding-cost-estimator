/**
 * REQ-3 end-to-end — the published ladders reach real estimates.
 *
 * The unit tests in core prove the arithmetic. These prove the wiring: that the
 * ladders in the rate files are loaded, applied, and visible in the notes, and
 * that a large estate is no longer billed at the first-tier rate throughout.
 */
import { describe, expect, it } from "vitest";
import { createEstimate } from "../create-estimate.ts";
import { estimateAzureAuditStorage } from "../azure/azure-storage-estimator.ts";
import { estimateAwsAuditStorage } from "../aws/aws-storage-estimator.ts";
import { loadFallbackFile, fallbackToRateCard } from "../rates/fallback-schema.ts";
import { AZURE_FALLBACK_PRICES_PATH, createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { AWS_FALLBACK_PRICES_PATH, createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";
import { priceQuantity } from "../rates/tiered-rate.ts";
import { mergeLiveOverFallback } from "../rates/merge-live-rates.ts";

const NOW = new Date("2026-08-15T00:00:00.000Z");
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  },
  cache: createRatesCache(),
};

const azureRates = fallbackToRateCard(loadFallbackFile(AZURE_FALLBACK_PRICES_PATH));
const awsRates = fallbackToRateCard(loadFallbackFile(AWS_FALLBACK_PRICES_PATH));

describe("ladders survive the trip from rate file to RateCard", () => {
  it("Azure blob capacity and egress carry their published boundaries", () => {
    expect(azureRates.unitTiers?.["blob-hot-lrs-capacity"]?.map((t) => t.fromUnits))
      .toStrictEqual([0, 51_200, 512_000]);
    expect(azureRates.unitTiers?.["azure-egress-gb"]?.map((t) => t.fromUnits))
      .toStrictEqual([0, 100, 10_335, 51_295, 153_695]);
  });

  it("AWS S3 and data transfer carry theirs", () => {
    expect(awsRates.unitTiers?.["s3-standard-storage"]?.map((t) => t.fromUnits))
      .toStrictEqual([0, 51_200, 512_000]);
    expect(awsRates.unitTiers?.["aws-egress-gb"]?.map((t) => t.fromUnits))
      .toStrictEqual([0, 10_240, 51_200, 153_600]);
  });

  it("a flat meter has no ladder and is priced flat", () => {
    expect(azureRates.unitTiers?.["eh-standard-tu"]).toBeUndefined();
    const r = priceQuantity(azureRates, "eh-standard-tu", 730);
    expect(r.tiered).toBe(false);
    expect(r.amount).toBeCloseTo(730 * 0.03, 10);
  });
});

describe("a large estate is no longer billed at the first tier throughout", () => {
  it("Azure audit storage above 50 TB uses the cheaper band", () => {
    const gb = 100_000;
    const res = estimateAzureAuditStorage(
      { enabled: true, region: "eastus", avgGB: gb },
      azureRates,
    );
    const naive = gb * 0.0208;
    const expected = 51_200 * 0.0208 + (gb - 51_200) * 0.019968;
    const capacity = res.lineItems.find(
      (l) => l.meterId === "blob-hot-lrs-capacity",
    );
    expect(capacity?.amount).toBeCloseTo(expected, 6);
    expect(capacity!.amount).toBeLessThan(naive);
  });

  it("AWS audit storage above 50 TB does too", () => {
    const gb = 600_000;
    const res = estimateAwsAuditStorage(
      { enabled: true, region: "us-east-1", avgGB: gb },
      awsRates,
    );
    const expected =
      51_200 * 0.023 + (512_000 - 51_200) * 0.022 + (gb - 512_000) * 0.021;
    expect(
      res.lineItems.find((l) => l.meterId === "s3-standard-storage")?.amount,
    ).toBeCloseTo(expected, 5);
  });

  it("EDGE: a small estate is unchanged — the first band is still the first band", () => {
    const gb = 500;
    const res = estimateAzureAuditStorage(
      { enabled: true, region: "eastus", avgGB: gb },
      azureRates,
    );
    expect(
      res.lineItems.find((l) => l.meterId === "blob-hot-lrs-capacity")?.amount,
    ).toBeCloseTo(gb * 0.0208, 10);
  });

  it("the notes show the bands, so the arithmetic can be followed", () => {
    const res = estimateAzureAuditStorage(
      { enabled: true, region: "eastus", avgGB: 100_000 },
      azureRates,
    );
    const notes = res.notes.join(" ");
    expect(notes).toMatch(/priced across published tiers/);
    expect(notes).toMatch(/51,200 units @ \$0\.0208/);
    expect(notes).toMatch(/blended \$/);
  });
});

describe("free allowances stay opt-in", () => {
  it("Azure egress charges from the first GB by default", () => {
    // The published ladder has a $0 band up to 100 GB, but that allowance is
    // granted per subscription and shared, so the conservative default assumes
    // it is already spent.
    const r = priceQuantity(azureRates, "azure-egress-gb", 50);
    expect(r.amount).toBeCloseTo(50 * 0.087, 10);
  });

  it("opting in honours the published free band", () => {
    const r = priceQuantity(azureRates, "azure-egress-gb", 50, {
      applyFreeAllowances: true,
    });
    expect(r.amount).toBe(0);
  });

  it("EDGE: opting in still charges above the allowance boundary", () => {
    const r = priceQuantity(azureRates, "azure-egress-gb", 1_000, {
      applyFreeAllowances: true,
    });
    expect(r.amount).toBeCloseTo(900 * 0.087, 10);
  });

  it("the note says which assumption was used", () => {
    const res = estimateAzureAuditStorage(
      { enabled: true, region: "eastus", avgGB: 100_000 },
      azureRates,
    );
    expect(res.notes.join(" ")).toMatch(/free allowance assumed already spent/);
  });
});

describe("full estimates stay coherent with ladders in play", () => {
  it("audit-only Azure still bills exactly the TF meters and stays High confidence", async () => {
    const res = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { accountCount: 10, avgStoredGB: 200_000 },
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    expect(res.confidence).toBe("High");
    expect(res.lineItems.map((l) => l.meterId).sort()).toStrictEqual([
      "blob-hot-lrs-capacity",
      "eh-standard-ingress-events",
      "eh-standard-tu",
    ]);
    // Tiering must reduce, never increase, the capacity line.
    const capacity = res.lineItems.find(
      (l) => l.meterId === "blob-hot-lrs-capacity",
    )!;
    expect(capacity.amount).toBeLessThan(200_000 * 0.0208);
  });
});

describe("ladders survive live rates — the silent-degradation fix", () => {
  // Tiering worked from the fallback file and vanished whenever a live or
  // cached rate card was used, because the merge rebuilt unitPrices by hand.
  // Same inputs, different answer, no warning: the defect this pins shut.
  const doc = loadFallbackFile(AZURE_FALLBACK_PRICES_PATH);

  it("a live price that confirms the recorded one keeps the ladder", () => {
    const { rates, warnings } = mergeLiveOverFallback(
      "azure",
      doc,
      { "blob-hot-lrs-capacity": 0.0208 },
      "2026-08-10T00:00:00.000Z",
    );
    expect(rates.unitTiers?.["blob-hot-lrs-capacity"]).toHaveLength(3);
    expect(warnings).toStrictEqual([]);
  });

  it("a meter the live query did not cover keeps its price and its ladder", () => {
    const { rates } = mergeLiveOverFallback("azure", doc, {}, "2026-08-10T00:00:00.000Z");
    expect(rates.unitPrices["blob-hot-lrs-capacity"]).toBe(0.0208);
    expect(rates.unitTiers?.["blob-hot-lrs-capacity"]).toHaveLength(3);
  });

  it("EDGE: a re-priced meter drops to flat and says so, rather than mixing fresh price with stale boundaries", () => {
    const { rates, warnings } = mergeLiveOverFallback(
      "azure",
      doc,
      { "blob-hot-lrs-capacity": 0.0999 },
      "2026-08-10T00:00:00.000Z",
    );
    expect(rates.unitPrices["blob-hot-lrs-capacity"]).toBe(0.0999);
    expect(rates.unitTiers?.["blob-hot-lrs-capacity"]).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/tier boundaries may be stale/);
    expect(warnings.join(" ")).toMatch(/rates:validate/);
  });

  it("EDGE: a live meter unknown to the document is honoured but gets no ladder", () => {
    const { rates } = mergeLiveOverFallback(
      "azure",
      doc,
      { "some-new-meter": 1.23 },
      "2026-08-10T00:00:00.000Z",
    );
    expect(rates.unitPrices["some-new-meter"]).toBe(1.23);
    expect(rates.unitTiers?.["some-new-meter"]).toBeUndefined();
  });
});
