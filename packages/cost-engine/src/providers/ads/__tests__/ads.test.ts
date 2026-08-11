/**
 * Package 08 — ADS Cloud / Outpost estimators.
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import { prorateSnapshotCost } from "../../../core/hours.ts";
import {
  snapshotGbMonthsUsedSize,
  isGovCloudRegion,
} from "../ads.types.ts";
import { estimateAds } from "../estimate-ads.ts";
import {
  AZURE_ADS_OUTPOST_METER,
  AZURE_ADS_SNAPSHOT_METER,
  estimateAzureAds,
} from "../../azure/azure-ads-estimator.ts";
import {
  AWS_ADS_SNAPSHOT_METER,
  estimateAwsAds,
} from "../../aws/aws-ads-estimator.ts";
import {
  GCP_ADS_SNAPSHOT_METER,
  estimateGcpAds,
} from "../../gcp/gcp-ads-estimator.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "managed-disk-snapshot": 0.05,
    "vm-outpost-scanner": 0.096,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const awsRates: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: {
    "ebs-snapshot-storage": 0.05,
    "ec2-outpost-scanner": 0.0416,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const gcpRates: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: {
    "pd-snapshot-storage": 0.026,
    "gce-outpost-scanner": 0.067,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const baseCloud = {
  enabled: true as const,
  region: "eastus",
  mode: "Cloud" as const,
  vmCount: 10,
  avgUsedDiskGB: 100,
  scansPerMonth: 4,
  snapshotLifetimeHours: 24,
  monthHours: 730,
};

describe("package 08 — REQ used-size proration", () => {
  it("prorates snapshot GB-months by lifetimeHours/730", () => {
    const gbMonths = snapshotGbMonthsUsedSize({
      vmCount: 10,
      avgUsedDiskGB: 100,
      scansPerMonth: 4,
      snapshotLifetimeHours: 24,
      monthHours: 730,
    });
    expect(gbMonths).toBeCloseTo(10 * 100 * 4 * (24 / 730));
  });
});

describe("package 08 — AC Cloud vs Outpost", () => {
  it("Cloud emits snapshot lines only (no compute)", () => {
    const r = estimateAzureAds(baseCloud, azureRates);
    expect(r.lineItems.every((l) => l.meterId === AZURE_ADS_SNAPSHOT_METER)).toBe(
      true,
    );
    expect(r.lineItems.some((l) => l.meterId === AZURE_ADS_OUTPOST_METER)).toBe(
      false,
    );
    expect(r.computeCost).toBe(0);
    expect(r.confidence).toBe("Med");
  });

  it("Outpost adds compute line with Med-Low (Low) confidence", () => {
    const r = estimateAzureAds(
      {
        ...baseCloud,
        mode: "Outpost",
        outpostVmSku: "Standard_D2s_v3",
        outpostHoursPerScan: 2,
      },
      azureRates,
    );
    expect(r.lineItems.some((l) => l.meterId === AZURE_ADS_SNAPSHOT_METER)).toBe(
      true,
    );
    expect(r.lineItems.some((l) => l.meterId === AZURE_ADS_OUTPOST_METER)).toBe(
      true,
    );
    expect(r.computeCost).toBeGreaterThan(0);
    expect(r.confidence).toBe("Low");
  });
});

describe("package 08 — TEST fixtures", () => {
  it("ADS off → $0", () => {
    const r = estimateAzureAds({ ...baseCloud, enabled: false }, azureRates);
    expect(r.totals.expected).toBe(0);
    expect(r.lineItems).toEqual([]);
  });

  it("used-size billing golden across Azure/AWS/GCP", () => {
    const expectedAz =
      10 *
      4 *
      prorateSnapshotCost(100, 0.05, 24, 730);
    expect(estimateAzureAds(baseCloud, azureRates).snapshotCost).toBeCloseTo(
      expectedAz,
    );
    expect(
      estimateAwsAds(
        { ...baseCloud, region: "us-east-1" },
        awsRates,
      ).snapshotCost,
    ).toBeCloseTo(10 * 4 * prorateSnapshotCost(100, 0.05, 24, 730));
    expect(
      estimateGcpAds(
        { ...baseCloud, region: "us-central1" },
        gcpRates,
      ).snapshotCost,
    ).toBeCloseTo(10 * 4 * prorateSnapshotCost(100, 0.026, 24, 730));
  });

  it("Cloud mode emits no compute line for all providers", () => {
    for (const [fn, rates, outMeter] of [
      [estimateAzureAds, azureRates, "vm-outpost-scanner"],
      [estimateAwsAds, awsRates, "ec2-outpost-scanner"],
      [estimateGcpAds, gcpRates, "gce-outpost-scanner"],
    ] as const) {
      const r = fn({ ...baseCloud, region: rates.region }, rates);
      expect(r.lineItems.some((l) => l.meterId === outMeter)).toBe(false);
    }
  });

  it("facade estimateAds routes provider", () => {
    const r = estimateAds("aws", { ...baseCloud, region: "us-east-1" }, awsRates);
    expect(r.lineItems[0]?.meterId).toBe(AWS_ADS_SNAPSHOT_METER);
  });
});

describe("package 08 — EDGE", () => {
  it("warns when provisioned >> used", () => {
    const r = estimateAzureAds(
      { ...baseCloud, avgProvisionedDiskGB: 500 },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/provisioned/i);
  });

  it("incremental model still bills full used size + warning", () => {
    const full = estimateAzureAds(baseCloud, azureRates);
    const incr = estimateAzureAds(
      { ...baseCloud, snapshotModel: "incremental" },
      azureRates,
    );
    expect(incr.snapshotCost).toBeCloseTo(full.snapshotCost);
    expect(incr.warnings.join(" ")).toMatch(/incremental/i);
  });

  it("zero VMs + ADS on warns", () => {
    const r = estimateAzureAds({ ...baseCloud, vmCount: 0 }, azureRates);
    expect(r.warnings.join(" ")).toMatch(/vmCount=0/i);
    expect(r.snapshotCost).toBe(0);
  });

  it("GovCloud region warns (availability rules)", () => {
    expect(isGovCloudRegion("usgovvirginia")).toBe(true);
    const r = estimateAzureAds(
      { ...baseCloud, region: "usgovvirginia", mode: "Outpost" },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/Government/i);
  });

  it("missing snapshot rate fails closed", () => {
    expect(() =>
      estimateAzureAds(baseCloud, { ...azureRates, unitPrices: {} }),
    ).toThrow(/missing unit price/);
  });

  it("meter ids match capability maps", () => {
    expect(AZURE_ADS_SNAPSHOT_METER).toBe("managed-disk-snapshot");
    expect(AWS_ADS_SNAPSHOT_METER).toBe("ebs-snapshot-storage");
    expect(GCP_ADS_SNAPSHOT_METER).toBe("pd-snapshot-storage");
  });
});
