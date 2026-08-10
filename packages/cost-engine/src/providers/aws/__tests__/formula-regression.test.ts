/**
 * Package 14 — AWS official formula regression (capacity + storage + ADS).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FREEZE_TOTAL_TOLERANCE_USD } from "../../../core/rate-pinning.ts";
import { snapshotGbMonthsUsedSize } from "../../ads/ads.types.ts";
import {
  estimateAwsAuditStream,
  sizeKinesisShards,
} from "../aws-stream-estimator.ts";
import { estimateAwsAuditStorage } from "../aws-storage-estimator.ts";
import { estimateAwsAds } from "../aws-ads-estimator.ts";
import {
  GOLDEN_ADS_INPUTS,
  GOLDEN_AWS_RATES,
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
    path.join(__dirname, "../../formula-regression/fixtures/aws-golden.json"),
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

describe("package 14 — AWS formula regression", () => {
  it("refuses silent env bypass", () => {
    assertFormulaChecksNotSkippedByEnv();
  });

  it("registry ties each AWS formula to an official URL", () => {
    const checks = formulaChecksForProvider("aws");
    expect(checks.length).toBeGreaterThanOrEqual(3);
    for (const c of checks) {
      expect(c.officialUrl).toMatch(/^https:\/\//);
      expect(golden.officialUrls).toContain(c.officialUrl);
    }
    expect(checks.some((c) => c.kind === "capacity_binding")).toBe(true);
    expect(checks.some((c) => c.kind === "snapshot_proration")).toBe(true);
  });

  it("capacity binding: 1 MB/s or 1000 eps → 1 shard (fails on regression)", () => {
    expect(
      sizeKinesisShards({ peakMBps: 1, peakEventsPerSec: 1000 }),
    ).toBe(golden.expected.capacityUnits);
    expect(
      sizeKinesisShards({ peakMBps: 1.1, peakEventsPerSec: 0 }),
    ).toBe(2);
  });

  it("golden fixture: stream + storage + ADS snapshot proration", () => {
    const stream = estimateAwsAuditStream(
      { ...GOLDEN_STREAM_INPUTS, region: "us-east-1" },
      GOLDEN_AWS_RATES,
    );
    expect(stream.provisionedCapacityUnits).toBe(
      golden.expected.capacityUnits,
    );
    expect(
      Math.abs(stream.totals.expected - golden.expected.streamTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);

    const storage = estimateAwsAuditStorage(
      {
        enabled: true,
        region: "us-east-1",
        avgGB: GOLDEN_STORAGE_AVG_GB,
        redundancy: "STANDARD",
      },
      GOLDEN_AWS_RATES,
    );
    expect(storage.capacityCost).toBeCloseTo(
      GOLDEN_STORAGE_AVG_GB *
        GOLDEN_AWS_RATES.unitPrices["s3-standard-storage"]!,
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

    const ads = estimateAwsAds(
      { ...GOLDEN_ADS_INPUTS, region: "us-east-1" },
      GOLDEN_AWS_RATES,
    );
    expect(
      Math.abs(ads.totals.expected - golden.expected.adsTotal),
    ).toBeLessThanOrEqual(FREEZE_TOTAL_TOLERANCE_USD);
    expect(ads.totals.expected).toBeCloseTo(
      gbMonths * GOLDEN_AWS_RATES.unitPrices["ebs-snapshot-storage"]!,
    );
  });
});
