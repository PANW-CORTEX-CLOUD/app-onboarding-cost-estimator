/**
 * Package 12 — BYO volume signals × stream estimators (shared under streams/).
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import { volumeSignalsToStreamInputs } from "../volume-to-stream.ts";
import { estimateAzureAuditStream } from "../../azure/azure-stream-estimator.ts";
import { estimateAwsAuditStream } from "../../aws/aws-stream-estimator.ts";
import { estimateGcpAuditStream } from "../../gcp/gcp-stream-estimator.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "eh-standard-tu": 0.03,
    "eh-standard-ingress-events": 0.028,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const awsRates: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: {
    "kinesis-shard-hour": 0.015,
    "kinesis-put-payload-units": 0.014,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

const gcpRates: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: {
    "pubsub-message-delivery": 0.04,
    "pubsub-storage": 0.27,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("package 12 — TEST BYO eliminates managed stream capacity", () => {
  it("zeros capacity across azure/aws/gcp", () => {
    const vol = {
      accountCount: 10,
      orgPreset: "medium" as const,
      byoManagedStream: true,
    };
    const { stream: azStream } = volumeSignalsToStreamInputs(
      { ...vol, provider: "azure" },
      { enabled: true, region: "eastus", monthHours: 730 },
    );
    const az = estimateAzureAuditStream(azStream, azureRates);
    expect(
      az.lineItems.find((l) => l.meterId === "eh-standard-tu")?.amount,
    ).toBe(0);

    const { stream: awsStream } = volumeSignalsToStreamInputs(
      { ...vol, provider: "aws" },
      { enabled: true, region: "us-east-1", monthHours: 730 },
    );
    const aws = estimateAwsAuditStream(awsStream, awsRates);
    expect(
      aws.lineItems.find((l) => l.meterId === "kinesis-shard-hour")?.amount,
    ).toBe(0);

    const { stream: gcpStream } = volumeSignalsToStreamInputs(
      { ...vol, provider: "gcp" },
      { enabled: true, region: "us-central1", monthHours: 730 },
    );
    const gcp = estimateGcpAuditStream(gcpStream, gcpRates);
    expect(
      gcp.lineItems.find((l) => l.meterId === "pubsub-storage")?.amount,
    ).toBe(0);
    expect(gcp.provisionedCapacityUnits).toBe(0);
  });
});
