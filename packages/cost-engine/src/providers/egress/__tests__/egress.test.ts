/**
 * Package 11 — egress / cross-cloud bandwidth.
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import { lookupEgressZone, AZURE_EGRESS_ZONES } from "../egress-zone-cards.ts";
import { estimateEgress } from "../estimate-egress.ts";
import {
  AZURE_EGRESS_METER,
  estimateAzureEgress,
} from "../../azure/azure-egress-estimator.ts";
import {
  AWS_EGRESS_METER,
  estimateAwsEgress,
} from "../../aws/aws-egress-estimator.ts";
import {
  GCP_EGRESS_METER,
  estimateGcpEgress,
} from "../../gcp/gcp-egress-estimator.ts";
import { DEFAULT_PRIVATE_PATH_FACTOR } from "../estimate-egress-core.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: { "azure-egress-gb": 0.087 },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const awsRates: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: { "aws-egress-gb": 0.09 },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const gcpRates: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: { "gcp-egress-gb": 0.12 },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("package 11 — REQ zone rate cards", () => {
  it("maps internet and cross-cloud zones (never free cross-cloud)", () => {
    const cross = lookupEgressZone(AZURE_EGRESS_ZONES, "cross-cloud");
    expect(cross?.rateMultiplier).toBeGreaterThan(0);
    expect(lookupEgressZone(AZURE_EGRESS_ZONES, "internet")).toBeTruthy();
  });
});

describe("package 11 — AC toggle + audit default", () => {
  it("defaults egress GB from stream ingress when egressGB unset", () => {
    const r = estimateAzureEgress(
      {
        enabled: true,
        region: "eastus",
        destinationZone: "internet",
        auditStreamIngressGBPerMonth: 100,
      },
      azureRates,
    );
    expect(r.billedEgressGB).toBe(100);
    expect(r.totals.expected).toBeCloseTo(100 * 0.087);
    expect(r.confidence).toBe("Low");
    expect(r.lineItems[0]?.meterId).toBe(AZURE_EGRESS_METER);
  });
});

describe("package 11 — TEST", () => {
  it("toggle off → $0", () => {
    for (const [fn, rates] of [
      [estimateAzureEgress, azureRates],
      [estimateAwsEgress, awsRates],
      [estimateGcpEgress, gcpRates],
    ] as const) {
      expect(
        fn(
          {
            enabled: false,
            region: "x",
            destinationZone: "internet",
            egressGB: 999,
          },
          rates,
        ).totals.expected,
      ).toBe(0);
    }
  });

  it("regional egress rate lookups for Azure/AWS/GCP", () => {
    expect(
      estimateAzureEgress(
        {
          enabled: true,
          region: "eastus",
          destinationZone: "internet",
          egressGB: 10,
        },
        azureRates,
      ).totals.expected,
    ).toBeCloseTo(10 * 0.087);
    expect(
      estimateAwsEgress(
        {
          enabled: true,
          region: "us-east-1",
          destinationZone: "internet",
          egressGB: 10,
        },
        awsRates,
      ).totals.expected,
    ).toBeCloseTo(10 * 0.09);
    expect(
      estimateGcpEgress(
        {
          enabled: true,
          region: "us-central1",
          destinationZone: "internet",
          egressGB: 10,
        },
        gcpRates,
      ).totals.expected,
    ).toBeCloseTo(10 * 0.12);
  });

  it("no double-counting when alreadyBilledElsewhere", () => {
    const r = estimateAzureEgress(
      {
        enabled: true,
        region: "eastus",
        destinationZone: "internet",
        egressGB: 50,
        alreadyBilledElsewhere: true,
      },
      azureRates,
    );
    expect(r.totals.expected).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/double-count/i);
  });

  it("facade routes providers", () => {
    const r = estimateEgress(
      "aws",
      {
        enabled: true,
        region: "us-east-1",
        destinationZone: "cross-cloud",
        egressGB: 5,
      },
      awsRates,
    );
    expect(r.lineItems[0]?.meterId).toBe(AWS_EGRESS_METER);
    expect(r.totals.expected).toBeGreaterThan(0);
  });
});

describe("package 11 — EDGE", () => {
  it("Private Link / VPC Endpoint reduces egress", () => {
    const full = estimateAzureEgress(
      {
        enabled: true,
        region: "eastus",
        destinationZone: "internet",
        egressGB: 100,
      },
      azureRates,
    );
    const priv = estimateAzureEgress(
      {
        enabled: true,
        region: "eastus",
        destinationZone: "internet",
        egressGB: 100,
        privateLinkOrVpcEndpoint: true,
      },
      azureRates,
    );
    expect(priv.billedEgressGB).toBeCloseTo(100 * DEFAULT_PRIVATE_PATH_FACTOR);
    expect(priv.totals.expected).toBeCloseTo(
      full.totals.expected * DEFAULT_PRIVATE_PATH_FACTOR,
    );
  });

  it("unknown zone → exclude + warn", () => {
    const r = estimateAzureEgress(
      {
        enabled: true,
        region: "eastus",
        destinationZone: "mars-orbit",
        egressGB: 10,
      },
      azureRates,
    );
    expect(r.excludedUnknownZone).toBe(true);
    expect(r.totals.expected).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/unknown destination zone/i);
  });

  it("GovCloud uses separate bandwidth card warning", () => {
    const r = estimateAwsEgress(
      {
        enabled: true,
        region: "us-gov-west-1",
        destinationZone: "internet",
        egressGB: 10,
      },
      awsRates,
    );
    expect(r.warnings.join(" ")).toMatch(/Gov/i);
    expect(r.totals.expected).toBeGreaterThan(10 * 0.09); // 1.2× multiplier
  });

  it("never invents free cross-cloud", () => {
    const r = estimateGcpEgress(
      {
        enabled: true,
        region: "us-central1",
        destinationZone: "cross-cloud",
        egressGB: 1,
      },
      gcpRates,
    );
    expect(r.totals.expected).toBeGreaterThan(0);
    expect(r.lineItems[0]?.meterId).toBe(GCP_EGRESS_METER);
  });

  it("missing volume fails closed", () => {
    expect(() =>
      estimateAzureEgress(
        {
          enabled: true,
          region: "eastus",
          destinationZone: "internet",
        },
        azureRates,
      ),
    ).toThrow(/egressGB or auditStreamIngressGBPerMonth/);
  });
});
