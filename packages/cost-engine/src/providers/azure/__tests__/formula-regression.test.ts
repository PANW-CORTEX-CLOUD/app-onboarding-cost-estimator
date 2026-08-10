/**
 * Package 14 — Azure official formula regression (capacity + storage + ADS).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREEZE_TOTAL_TOLERANCE_USD } from "../../../core/rate-pinning.ts";
import { snapshotGbMonthsUsedSize } from "../../ads/ads.types.ts";
import {
  AZURE_EH_INCLUDED_GB_PER_TU,
  AZURE_EH_EPS_PER_TU,
  AZURE_EH_MBPS_PER_TU,
  estimateAzureAuditStream,
  sizeAzureEventHubTus,
} from "../azure-stream-estimator.ts";
import { estimateAzureAuditStorage } from "../azure-storage-estimator.ts";
import { estimateAzureAds } from "../azure-ads-estimator.ts";
import {
  GOLDEN_ADS_INPUTS,
  GOLDEN_AZURE_RATES,
  GOLDEN_SNAPSHOT_GB_MONTHS,
  GOLDEN_STORAGE_AVG_GB,
  GOLDEN_STREAM_INPUTS,
} from "../../formula-regression/golden-inputs.ts";
import {
  assertFormulaChecksNotSkippedByEnv,
  formulaChecksForProvider,
} from "../../formula-regression/registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../formula-regression/fixtures/azure-golden.json",
    ),
    "utf8",
  ),
) as {
  expected: {
    capacityUnits: number;
    streamTotal: number;
    storageTotal: number;
    adsTotal: number;
    snapshotGbMonths: number;
  };
  officialUrls: string[];
};

describe("package 14 — Azure formula regression", () => {
  it("refuses silent env bypass", () => {
    assertFormulaChecksNotSkippedByEnv();
  });

  it("registry ties each Azure formula to an official URL", () => {
    const checks = formulaChecksForProvider("azure");
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const c of checks) {
      expect(c.officialUrl).toMatch(/^https:\/\//);
      expect(golden.officialUrls).toContain(c.officialUrl);
    }
    expect(checks.some((c) => c.kind === "capacity_binding")).toBe(true);
    expect(checks.some((c) => c.kind === "snapshot_proration")).toBe(true);
  });

  it("capacity binding: 1 MB/s or 1000 eps → 1 TU (fails on regression)", () => {
    expect(AZURE_EH_MBPS_PER_TU).toBe(1);
    expect(AZURE_EH_EPS_PER_TU).toBe(1000);
    expect(AZURE_EH_INCLUDED_GB_PER_TU).toBe(84);
    expect(
      sizeAzureEventHubTus({ peakMBps: 1, peakEventsPerSec: 1000 }),
    ).toBe(golden.expected.capacityUnits);
    expect(
      sizeAzureEventHubTus({ peakMBps: 1.1, peakEventsPerSec: 0 }),
    ).toBe(2);
  });

  it("golden fixture: stream + storage + ADS snapshot proration", () => {
    const stream = estimateAzureAuditStream(
      { ...GOLDEN_STREAM_INPUTS, region: "eastus" },
      GOLDEN_AZURE_RATES,
    );
    expect(stream.provisionedCapacityUnits).toBe(
      golden.expected.capacityUnits,
    );
    expect(
      Math.abs(stream.totals.expected - golden.expected.streamTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);

    const storage = estimateAzureAuditStorage(
      {
        enabled: true,
        region: "eastus",
        avgGB: GOLDEN_STORAGE_AVG_GB,
      },
      GOLDEN_AZURE_RATES,
    );
    expect(storage.capacityCost).toBeCloseTo(
      GOLDEN_STORAGE_AVG_GB *
        GOLDEN_AZURE_RATES.unitPrices["blob-hot-lrs-capacity"]!,
    );
    expect(
      Math.abs(storage.totals.expected - golden.expected.storageTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);

    const gbMonths = snapshotGbMonthsUsedSize({
      vmCount: GOLDEN_ADS_INPUTS.vmCount,
      avgUsedDiskGB: GOLDEN_ADS_INPUTS.avgUsedDiskGB,
      scansPerMonth: GOLDEN_ADS_INPUTS.scansPerMonth,
      snapshotLifetimeHours: GOLDEN_ADS_INPUTS.snapshotLifetimeHours,
      monthHours: GOLDEN_ADS_INPUTS.monthHours,
    });
    expect(gbMonths).toBeCloseTo(GOLDEN_SNAPSHOT_GB_MONTHS);
    expect(gbMonths).toBeCloseTo(golden.expected.snapshotGbMonths);

    const ads = estimateAzureAds(
      { ...GOLDEN_ADS_INPUTS, region: "eastus" },
      GOLDEN_AZURE_RATES,
    );
    expect(
      Math.abs(ads.totals.expected - golden.expected.adsTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);
    // Proration regression guard: adsTotal ≈ gbMonths × snapshot rate
    expect(ads.totals.expected).toBeCloseTo(
      gbMonths * GOLDEN_AZURE_RATES.unitPrices["managed-disk-snapshot"]!,
    );
  });
});
