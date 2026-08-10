/**
 * Package 07 — audit storage estimators (Blob LRS / S3 Standard / GCS Standard).
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import {
  DEFAULT_AUDIT_STORAGE_FLOOR_GB,
} from "../audit-storage.types.ts";
import { estimateAuditStorage } from "../estimate-audit-storage.ts";
import {
  AZURE_AUDIT_CAPACITY_METER,
  estimateAzureAuditStorage,
} from "../../azure/azure-storage-estimator.ts";
import {
  AWS_AUDIT_CAPACITY_METER,
  estimateAwsAuditStorage,
} from "../../aws/aws-storage-estimator.ts";
import {
  GCP_AUDIT_CAPACITY_METER,
  estimateGcpAuditStorage,
} from "../../gcp/gcp-storage-estimator.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "blob-hot-lrs-capacity": 0.0208,
    "blob-hot-lrs-write-10k": 0.055,
    "blob-hot-lrs-read-10k": 0.004,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const awsRates: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: {
    "s3-standard-storage": 0.023,
    "s3-put-1k": 0.005,
    "s3-get-1k": 0.0004,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const gcpRates: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: {
    "gcs-standard-storage": 0.02,
    "gcs-class-a-10k": 0.05,
    "gcs-class-b-10k": 0.004,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("package 07 — REQ estimateAuditStorage", () => {
  it("estimates Azure Blob LRS, AWS S3, GCP GCS capacity", () => {
    const az = estimateAzureAuditStorage(
      { enabled: true, region: "eastus", avgGB: 100 },
      azureRates,
    );
    const aws = estimateAwsAuditStorage(
      { enabled: true, region: "us-east-1", avgGB: 100, redundancy: "STANDARD" },
      awsRates,
    );
    const gcp = estimateGcpAuditStorage(
      { enabled: true, region: "us-central1", avgGB: 100, redundancy: "STANDARD" },
      gcpRates,
    );
    expect(az.capacityCost).toBeCloseTo(100 * 0.0208);
    expect(aws.capacityCost).toBeCloseTo(100 * 0.023);
    expect(gcp.capacityCost).toBeCloseTo(100 * 0.02);
  });
});

describe("package 07 — AC floor + ops + audit_logs tags", () => {
  it("applies default floor when audit enabled and avgGB unset", () => {
    const r = estimateAzureAuditStorage(
      { enabled: true, region: "eastus" },
      azureRates,
    );
    expect(r.capacityGb).toBe(DEFAULT_AUDIT_STORAGE_FLOOR_GB);
    expect(r.warnings.join(" ")).toMatch(/floor/i);
  });

  it("accepts avgGB and write/read ops; tags capability audit_logs", () => {
    const r = estimateAzureAuditStorage(
      {
        enabled: true,
        region: "eastus",
        avgGB: 50,
        writeOpsPerMonth: 20_000,
        readOpsPerMonth: 10_000,
      },
      azureRates,
    );
    expect(r.opsCost).toBeCloseTo(2 * 0.055 + 1 * 0.004);
    expect(r.lineItems.every((l) => l.capability === "audit_logs")).toBe(true);
    expect(r.lineItems.every((l) => l.provider === "azure")).toBe(true);
  });
});

describe("package 07 — TEST", () => {
  it("audit off → $0 for all providers", () => {
    for (const [fn, rates] of [
      [estimateAzureAuditStorage, azureRates],
      [estimateAwsAuditStorage, awsRates],
      [estimateGcpAuditStorage, gcpRates],
    ] as const) {
      const r = fn(
        { enabled: false, region: "x", avgGB: 999, writeOpsPerMonth: 1e6 },
        rates,
      );
      expect(r.totals.expected).toBe(0);
      expect(r.lineItems).toEqual([]);
    }
  });

  it("capacityCost = GB × retail_GB_month for Azure Blob / AWS S3 / GCP GCS", () => {
    expect(
      estimateAzureAuditStorage(
        { enabled: true, region: "eastus", avgGB: 10 },
        azureRates,
      ).capacityCost,
    ).toBe(10 * azureRates.unitPrices[AZURE_AUDIT_CAPACITY_METER]!);
    expect(
      estimateAwsAuditStorage(
        { enabled: true, region: "us-east-1", avgGB: 10, redundancy: "S3_STANDARD" },
        awsRates,
      ).capacityCost,
    ).toBe(10 * awsRates.unitPrices[AWS_AUDIT_CAPACITY_METER]!);
    expect(
      estimateGcpAuditStorage(
        { enabled: true, region: "us-central1", avgGB: 10, redundancy: "GCS_STANDARD" },
        gcpRates,
      ).capacityCost,
    ).toBe(10 * gcpRates.unitPrices[GCP_AUDIT_CAPACITY_METER]!);
  });

  it("facade routes by provider", () => {
    const r = estimateAuditStorage(
      "aws",
      { enabled: true, region: "us-east-1", avgGB: 5 },
      awsRates,
    );
    expect(r.capacityCost).toBeCloseTo(5 * 0.023);
  });
});

describe("package 07 — EDGE", () => {
  it("notes no lifecycle auto-delete assumption", () => {
    const r = estimateAzureAuditStorage(
      { enabled: true, region: "eastus", avgGB: 1 },
      azureRates,
    );
    expect(r.notes.join(" ")).toMatch(/No lifecycle auto-delete/i);
  });

  it("non-standard redundancy fails closed", () => {
    expect(() =>
      estimateAzureAuditStorage(
        { enabled: true, region: "eastus", avgGB: 1, redundancy: "GRS" },
        azureRates,
      ),
    ).toThrow(/GRS|fails closed/i);
    expect(() =>
      estimateAwsAuditStorage(
        { enabled: true, region: "us-east-1", avgGB: 1, redundancy: "ONEZONE_IA" },
        awsRates,
      ),
    ).toThrow(/fails closed/i);
    expect(() =>
      estimateGcpAuditStorage(
        { enabled: true, region: "us-central1", avgGB: 1, redundancy: "MULTI_REGION" },
        gcpRates,
      ),
    ).toThrow(/fails closed/i);
  });

  it("missing capacity rate fails closed (no invented $0)", () => {
    expect(() =>
      estimateAzureAuditStorage(
        { enabled: true, region: "eastus", avgGB: 1 },
        { ...azureRates, unitPrices: {} },
      ),
    ).toThrow(/missing unit price/);
  });

  it("negative avgGB fails closed instead of silently applying the floor", () => {
    // A negative avgGB is invalid input, not "unset" - it must not be
    // treated the same as an omitted value (which legitimately floors to
    // DEFAULT_AUDIT_STORAGE_FLOOR_GB). Matches the writeOps/readOps
    // negative check a few lines below in each provider estimator.
    expect(() =>
      estimateAzureAuditStorage(
        { enabled: true, region: "eastus", avgGB: -500 },
        azureRates,
      ),
    ).toThrow(/avgGB must be non-negative/);
    expect(() =>
      estimateAwsAuditStorage(
        { enabled: true, region: "us-east-1", avgGB: -1 },
        awsRates,
      ),
    ).toThrow(/avgGB must be non-negative/);
    expect(() =>
      estimateGcpAuditStorage(
        { enabled: true, region: "us-central1", avgGB: -1 },
        gcpRates,
      ),
    ).toThrow(/avgGB must be non-negative/);
  });
});
