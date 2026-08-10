/**
 * Package 09 — DSPM band estimators (Azure/AWS/GCP).
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import {
  DSPM_BAND_HIGH_FACTOR,
  DSPM_BAND_LOW_FACTOR,
} from "../dspm.types.ts";
import { estimateDspm } from "../estimate-dspm.ts";
import {
  AZURE_DSPM_READ_METER,
  estimateAzureDspm,
} from "../../azure/azure-dspm-estimator.ts";
import {
  AWS_DSPM_READ_METER,
  estimateAwsDspm,
} from "../../aws/aws-dspm-estimator.ts";
import {
  GCP_DSPM_READ_METER,
  estimateGcpDspm,
} from "../../gcp/gcp-dspm-estimator.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "blob-hot-lrs-read-10k": 0.004,
    "blob-hot-lrs-list-10k": 0.05,
    "vm-outpost-scanner": 0.096,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const awsRates: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: {
    "s3-get-10k": 0.004,
    "s3-put-10k": 0.05,
    "ec2-outpost-scanner": 0.0416,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const gcpRates: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: {
    "gcs-class-b-10k": 0.004,
    "gcs-class-a-10k": 0.05,
    "gce-outpost-scanner": 0.0475,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const base = {
  enabled: true as const,
  region: "eastus",
  dataEstateGB: 1000,
  pctScanned: 10,
  scansPerMonth: 1,
  discoveryTelemetryEmpty: false,
};

describe("package 09 — REQ estimateDspm band", () => {
  it("returns Low confidence band with data-read line items", () => {
    const r = estimateAzureDspm(base, azureRates);
    expect(r.confidence).toBe("Low");
    expect(r.showLowConfidenceWarning).toBe(true);
    expect(r.lineItems.some((l) => l.meterId === AZURE_DSPM_READ_METER)).toBe(
      true,
    );
    expect(r.totals.low).toBeLessThan(r.totals.expected);
    expect(r.totals.high).toBeGreaterThan(r.totals.expected);
  });
});

describe("package 09 — AC inputs + band", () => {
  it("scales by dataEstateGB × pctScanned × scansPerMonth", () => {
    // 1000 * 0.1 * 1 = 100 GB scanned × 0.004
    const r = estimateAzureDspm(base, azureRates);
    expect(r.scannedGB).toBe(100);
    // Scanning is billed per operation: 100 GB at the default 4 MB average
    // object size is 25,600 objects → 25,600 reads + ceil(25,600/5,000) lists.
    const objects = (100 * 1024) / 4;
    const readCost = (objects / 10_000) * 0.004;
    const listCost = (Math.ceil(objects / 5_000) / 10_000) * 0.05;
    expect(r.totals.expected).toBeCloseTo(readCost + listCost, 12);
    expect(r.totals.low).toBeCloseTo(r.totals.expected * DSPM_BAND_LOW_FACTOR);
    expect(r.totals.high).toBeCloseTo(r.totals.expected * DSPM_BAND_HIGH_FACTOR);
  });
});

describe("package 09 — TEST", () => {
  it("off → $0 band", () => {
    const r = estimateAzureDspm({ ...base, enabled: false }, azureRates);
    expect(r.totals).toEqual({ low: 0, expected: 0, high: 0 });
    expect(r.lineItems).toEqual([]);
    expect(r.showLowConfidenceWarning).toBe(false);
  });

  it("2× data estate doubles expected band", () => {
    const a = estimateAzureDspm(base, azureRates);
    const b = estimateAzureDspm({ ...base, dataEstateGB: 2000 }, azureRates);
    expect(b.totals.expected).toBeCloseTo(a.totals.expected * 2);
    expect(b.totals.low).toBeCloseTo(a.totals.low * 2);
    expect(b.totals.high).toBeCloseTo(a.totals.high * 2);
  });

  it("Azure Gov DSPM fails closed", () => {
    expect(() =>
      estimateAzureDspm({ ...base, region: "usgovvirginia" }, azureRates),
    ).toThrow(/N\/A|fail closed/i);
  });

  it("AWS/GCP Gov warn but still return a band", () => {
    const aws = estimateAwsDspm(
      { ...base, region: "us-gov-west-1" },
      awsRates,
    );
    expect(aws.warnings.join(" ")).toMatch(/Gov/i);
    expect(aws.totals.expected).toBeGreaterThanOrEqual(0);
    expect(aws.totals.low).toBeDefined();
    expect(aws.totals.high).toBeDefined();
  });

  it("never returns a single point without band when enabled", () => {
    const r = estimateGcpDspm(
      { ...base, region: "us-central1" },
      gcpRates,
    );
    expect(r.totals.low).not.toBe(r.totals.high);
    expect(Object.keys(r.totals).sort()).toEqual(["expected", "high", "low"]);
  });

  it("facade routes providers", () => {
    const r = estimateDspm("aws", { ...base, region: "us-east-1" }, awsRates);
    expect(r.lineItems[0]?.meterId).toBe(AWS_DSPM_READ_METER);
  });
});

describe("package 09 — EDGE", () => {
  it("empty discovery + zero estate refuses silent precision", () => {
    expect(() =>
      estimateAzureDspm(
        {
          ...base,
          dataEstateGB: 0,
          discoveryTelemetryEmpty: true,
        },
        azureRates,
      ),
    ).toThrow(/refuse silent precision/i);
  });

  it("0 GB estate + toggle on warns when discovery not empty", () => {
    const r = estimateAzureDspm(
      {
        ...base,
        dataEstateGB: 0,
        discoveryTelemetryEmpty: false,
      },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/dataEstateGB=0/i);
    expect(r.totals.expected).toBe(0);
  });

  it("ephemeral uplift is opt-in only", () => {
    const baseCost = estimateAzureDspm(base, azureRates).totals.expected;
    const withEph = estimateAzureDspm(
      {
        ...base,
        includeEphemeralInfra: true,
        ephemeralHoursPerScan: 2,
        scansPerMonth: 3,
      },
      azureRates,
    );
    expect(withEph.totals.expected).toBeGreaterThan(baseCost);
    expect(withEph.notes.join(" ")).toMatch(/ephemeral/i);
  });

  it("meter ids match capability maps", () => {
    // Scanning bills operations, so these are the vendors' operation meters —
    // not the per-GB "band" meters this repo previously invented.
    expect(AZURE_DSPM_READ_METER).toBe("blob-hot-lrs-read-10k");
    expect(AWS_DSPM_READ_METER).toBe("s3-get-10k");
    expect(GCP_DSPM_READ_METER).toBe("gcs-class-b-10k");
  });
});
