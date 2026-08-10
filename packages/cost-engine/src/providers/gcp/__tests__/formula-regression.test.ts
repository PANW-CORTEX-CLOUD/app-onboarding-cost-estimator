/**
 * Package 14 — GCP official formula regression (Pub/Sub + storage + ADS).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREEZE_TOTAL_TOLERANCE_USD } from "../../../core/rate-pinning.ts";
import { snapshotGbMonthsUsedSize } from "../../ads/ads.types.ts";
import { estimateGcpAuditStream } from "../gcp-stream-estimator.ts";
import { estimateGcpAuditStorage } from "../gcp-storage-estimator.ts";
import { estimateGcpAds } from "../gcp-ads-estimator.ts";
import {
  GOLDEN_ADS_INPUTS,
  GOLDEN_GCP_RATES,
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
    path.join(__dirname, "../../formula-regression/fixtures/gcp-golden.json"),
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

describe("package 14 — GCP formula regression", () => {
  it("refuses silent env bypass", () => {
    assertFormulaChecksNotSkippedByEnv();
  });

  it("registry ties each GCP formula to an official URL", () => {
    const checks = formulaChecksForProvider("gcp");
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const c of checks) {
      expect(c.officialUrl).toMatch(/^https:\/\//);
      expect(golden.officialUrls).toContain(c.officialUrl);
    }
    expect(checks.some((c) => c.kind === "capacity_binding")).toBe(true);
    expect(checks.some((c) => c.kind === "snapshot_proration")).toBe(true);
  });

  it("golden fixture: stream + storage + ADS snapshot proration", () => {
    const stream = estimateGcpAuditStream(
      { ...GOLDEN_STREAM_INPUTS, region: "us-central1" },
      GOLDEN_GCP_RATES,
    );
    expect(stream.provisionedCapacityUnits).toBeGreaterThanOrEqual(
      golden.expected.capacityUnits,
    );
    expect(
      Math.abs(stream.totals.expected - golden.expected.streamTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);

    const storage = estimateGcpAuditStorage(
      {
        enabled: true,
        region: "us-central1",
        avgGB: GOLDEN_STORAGE_AVG_GB,
        redundancy: "STANDARD",
      },
      GOLDEN_GCP_RATES,
    );
    expect(storage.capacityCost).toBeCloseTo(
      GOLDEN_STORAGE_AVG_GB *
        GOLDEN_GCP_RATES.unitPrices["gcs-standard-storage"]!,
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

    const ads = estimateGcpAds(
      { ...GOLDEN_ADS_INPUTS, region: "us-central1" },
      GOLDEN_GCP_RATES,
    );
    expect(
      Math.abs(ads.totals.expected - golden.expected.adsTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);
    expect(ads.totals.expected).toBeCloseTo(
      gbMonths * GOLDEN_GCP_RATES.unitPrices["pd-snapshot-storage"]!,
    );
  });

  it("EDGE: negative ingress/retention fail closed instead of billing a negative amount", () => {
    expect(() =>
      estimateGcpAuditStream(
        { ...GOLDEN_STREAM_INPUTS, region: "us-central1", ingressGBPerDay: -5 },
        GOLDEN_GCP_RATES,
      ),
    ).toThrow(/ingressGBPerDay must be non-negative/);

    expect(() =>
      estimateGcpAuditStream(
        {
          ...GOLDEN_STREAM_INPUTS,
          region: "us-central1",
          retentionDays: -1,
        },
        GOLDEN_GCP_RATES,
      ),
    ).toThrow(/retentionDays must be non-negative/);
  });
});
