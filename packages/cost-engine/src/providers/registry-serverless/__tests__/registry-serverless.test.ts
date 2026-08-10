/**
 * Package 10 — registry + serverless scan estimators.
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import {
  estimateRegistryScan,
  estimateServerlessScan,
} from "../estimate-scans.ts";
import {
  AZURE_REGISTRY_METER,
  AZURE_SERVERLESS_METER,
  estimateAzureRegistryScan,
  estimateAzureServerlessScan,
} from "../../azure/azure-registry-serverless.ts";
import {
  AWS_REGISTRY_METER,
  estimateAwsRegistryScan,
  estimateAwsServerlessScan,
} from "../../aws/aws-registry-serverless.ts";
import {
  GCP_REGISTRY_METER,
  estimateGcpRegistryScan,
  estimateGcpServerlessScan,
} from "../../gcp/gcp-registry-serverless.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "azure-egress-gb": 0.087,
    "functions-scan-ops": 0.2,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const awsRates: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: {
    "aws-egress-gb": 0.09,
    "lambda-scan-ops": 0.2,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const gcpRates: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: {
    "gcp-egress-gb": 0.12,
    "cloud-run-scan-ops": 0.4,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("package 10 — REQ registry + serverless engines", () => {
  it("exposes ACR/ECR/AR and Functions/Lambda/Run meters", () => {
    // Registries publish no per-GB pull charge — scanning bills real egress.
    expect(AZURE_REGISTRY_METER).toBe("azure-egress-gb");
    expect(AWS_REGISTRY_METER).toBe("aws-egress-gb");
    expect(GCP_REGISTRY_METER).toBe("gcp-egress-gb");
    expect(AZURE_SERVERLESS_METER).toBe("functions-scan-ops");
  });
});

describe("package 10 — AC independent toggles", () => {
  it("registry and serverless are independently toggled", () => {
    const regOn = estimateAzureRegistryScan(
      {
        enabled: true,
        region: "eastus",
        imageCount: 10,
        avgImageGB: 1,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      azureRates,
    );
    const regOff = estimateAzureRegistryScan(
      {
        enabled: false,
        region: "eastus",
        imageCount: 10,
        avgImageGB: 1,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      azureRates,
    );
    const svOn = estimateAzureServerlessScan(
      {
        enabled: true,
        region: "eastus",
        packageCount: 1_000_000,
        avgPackageGB: 0.01,
        scansPerMonth: 1,
      },
      azureRates,
    );
    const svOff = estimateAzureServerlessScan(
      {
        enabled: false,
        region: "eastus",
        packageCount: 1_000_000,
        avgPackageGB: 0.01,
        scansPerMonth: 1,
      },
      azureRates,
    );
    expect(regOn.totals.expected).toBeGreaterThan(0);
    expect(regOff.totals.expected).toBe(0);
    expect(svOn.totals.expected).toBeGreaterThan(0);
    expect(svOff.totals.expected).toBe(0);
    expect(regOn.confidence).toBe("Low");
    expect(svOn.lineItems[0]?.capability).toBe("serverless");
  });
});

describe("package 10 — TEST", () => {
  it("isolation: off → $0 for all providers", () => {
    for (const [regFn, svFn, rates] of [
      [estimateAzureRegistryScan, estimateAzureServerlessScan, azureRates],
      [estimateAwsRegistryScan, estimateAwsServerlessScan, awsRates],
      [estimateGcpRegistryScan, estimateGcpServerlessScan, gcpRates],
    ] as const) {
      expect(
        regFn(
          {
            enabled: false,
            region: "x",
            imageCount: 100,
            avgImageGB: 2,
            scansPerMonth: 4,
            crossRegionPull: true,
          },
          rates,
        ).totals.expected,
      ).toBe(0);
      expect(
        svFn(
          {
            enabled: false,
            region: "x",
            packageCount: 100,
            avgPackageGB: 1,
            scansPerMonth: 4,
          },
          rates,
        ).totals.expected,
      ).toBe(0);
    }
  });

  it("costs scale with scan volume (cross-region registry)", () => {
    const a = estimateAzureRegistryScan(
      {
        enabled: true,
        region: "eastus",
        imageCount: 10,
        avgImageGB: 2,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      azureRates,
    );
    const b = estimateAzureRegistryScan(
      {
        enabled: true,
        region: "eastus",
        imageCount: 20,
        avgImageGB: 2,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      azureRates,
    );
    expect(b.totals.expected).toBeCloseTo(a.totals.expected * 2);
  });

  it("same-region pull defaults to $0 bandwidth; cross-region uplifts", () => {
    const same = estimateAwsRegistryScan(
      {
        enabled: true,
        region: "us-east-1",
        imageCount: 5,
        avgImageGB: 1,
        scansPerMonth: 2,
        crossRegionPull: false,
      },
      awsRates,
    );
    const cross = estimateAwsRegistryScan(
      {
        enabled: true,
        region: "us-east-1",
        imageCount: 5,
        avgImageGB: 1,
        scansPerMonth: 2,
        crossRegionPull: true,
      },
      awsRates,
    );
    expect(same.totals.expected).toBe(0);
    expect(cross.totals.expected).toBeCloseTo(5 * 1 * 2 * 0.09);
  });

  it("serverless costs scale with package × scans", () => {
    const a = estimateGcpServerlessScan(
      {
        enabled: true,
        region: "us-central1",
        packageCount: 2_000_000,
        avgPackageGB: 0,
        scansPerMonth: 1,
      },
      gcpRates,
    );
    const b = estimateGcpServerlessScan(
      {
        enabled: true,
        region: "us-central1",
        packageCount: 2_000_000,
        avgPackageGB: 0,
        scansPerMonth: 2,
      },
      gcpRates,
    );
    expect(b.totals.expected).toBeCloseTo(a.totals.expected * 2);
  });

  it("facades route by provider", () => {
    const r = estimateRegistryScan(
      "gcp",
      {
        enabled: true,
        region: "us-central1",
        imageCount: 1,
        avgImageGB: 1,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      gcpRates,
    );
    expect(r.lineItems[0]?.meterId).toBe(GCP_REGISTRY_METER);
    const s = estimateServerlessScan(
      "aws",
      {
        enabled: true,
        region: "us-east-1",
        packageCount: 1_000_000,
        avgPackageGB: 0,
        scansPerMonth: 1,
      },
      awsRates,
    );
    expect(s.totals.expected).toBeCloseTo(0.2);
  });
});

describe("package 10 — EDGE", () => {
  it("notes do not charge existing registry/function storage", () => {
    const r = estimateAzureRegistryScan(
      {
        enabled: true,
        region: "eastus",
        imageCount: 1,
        avgImageGB: 1,
        scansPerMonth: 1,
      },
      azureRates,
    );
    expect(r.notes.join(" ")).toMatch(/Do not charge existing registry storage/i);
    const s = estimateAzureServerlessScan(
      {
        enabled: true,
        region: "eastus",
        packageCount: 1,
        avgPackageGB: 0.1,
        scansPerMonth: 1,
      },
      azureRates,
    );
    expect(s.notes.join(" ")).toMatch(/Do not charge existing function/i);
  });

  it("zero images/packages + toggle on warns", () => {
    const r = estimateAzureRegistryScan(
      {
        enabled: true,
        region: "eastus",
        imageCount: 0,
        avgImageGB: 1,
        scansPerMonth: 1,
        crossRegionPull: true,
      },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/imageCount=0/i);
    const s = estimateAzureServerlessScan(
      {
        enabled: true,
        region: "eastus",
        packageCount: 0,
        avgPackageGB: 1,
        scansPerMonth: 1,
      },
      azureRates,
    );
    expect(s.warnings.join(" ")).toMatch(/packageCount=0/i);
  });
});
