/**
 * Package 06 — audit stream estimators (Azure EH / AWS Kinesis / GCP PubSub).
 * Lives under providers/streams (not a single provider tree) to allow multi-cloud fixtures.
 */
import { describe, expect, it } from "vitest";
import type { RateCard } from "../../../core/models/estimate.types.ts";
import {
  ORG_STREAM_PRESETS,
  applyOrgPreset,
} from "../audit-stream.types.ts";
import { estimateAuditStream } from "../estimate-audit-stream.ts";
import {
  AZURE_EH_INCLUDED_GB_PER_TU,
  AZURE_EH_MAX_TU,
  estimateAzureAuditStream,
  sizeAzureEventHubTus,
} from "../../azure/azure-stream-estimator.ts";
import {
  estimateAwsAuditStream,
  sizeKinesisShards,
  kinesisPutPayloadUnits,
} from "../../aws/aws-stream-estimator.ts";
import { estimateGcpAuditStream } from "../../gcp/gcp-stream-estimator.ts";
import { AZURE_TF_DEFAULTS } from "../../azure/capability-meter-map.ts";

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

describe("package 06 — REQ min capacity when audit on", () => {
  it("Azure / AWS / GCP enforce minimum capacity unit when enabled", () => {
    expect(sizeAzureEventHubTus({ peakMBps: 0, peakEventsPerSec: 0 })).toBe(1);
    expect(sizeKinesisShards({ peakMBps: 0, peakEventsPerSec: 0 })).toBe(1);
    const gcp = estimateGcpAuditStream(
      {
        enabled: true,
        region: "us-central1",
        ingressGBPerDay: 0,
        peakMBps: 0,
        peakEventsPerSec: 0,
      },
      gcpRates,
    );
    expect(gcp.provisionedCapacityUnits).toBeGreaterThanOrEqual(1);
    expect(gcp.totals.expected).toBeGreaterThan(0);
  });

  it("respects Azure TF max auto-inflate 20 TU", () => {
    expect(AZURE_EH_MAX_TU).toBe(20);
    expect(
      sizeAzureEventHubTus({ peakMBps: 100, peakEventsPerSec: 100_000 }),
    ).toBe(20);
    expect(AZURE_TF_DEFAULTS.captureConfigured).toBe(false);
  });
});

describe("package 06 — AC inputs/outputs + org presets", () => {
  it("org presets map to volume signals", () => {
    const r = applyOrgPreset({
      enabled: true,
      region: "eastus",
      ingressGBPerDay: 0,
      peakMBps: 0,
      peakEventsPerSec: 0,
      orgPreset: "medium",
    });
    expect(r.ingressGBPerDay).toBe(ORG_STREAM_PRESETS.medium.ingressGBPerDay);
    expect(r.peakMBps).toBe(ORG_STREAM_PRESETS.medium.peakMBps);
  });

  it("assumedEventBytes changes Azure ingress events amount", () => {
    const inputs = {
      enabled: true,
      region: "eastus",
      ingressGBPerDay: 10,
      peakMBps: 1,
      peakEventsPerSec: 1000,
      monthHours: 730,
    };
    const base = estimateAzureAuditStream(inputs, azureRates);
    const larger = estimateAzureAuditStream(
      { ...inputs, assumedEventBytes: 2048 },
      azureRates,
    );
    const ingressBase = base.lineItems.find(
      (l) => l.meterId === "eh-standard-ingress-events",
    )!.amount;
    const ingressLarge = larger.lineItems.find(
      (l) => l.meterId === "eh-standard-ingress-events",
    )!.amount;
    expect(ingressLarge).toBeLessThan(ingressBase);
  });

  it("Azure returns provisioned capacity hours, ingress events, retention overage fields", () => {
    const r = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
        retentionDays: 7,
        monthHours: 730,
      },
      azureRates,
    );
    expect(r.provisionedCapacityUnits).toBeGreaterThanOrEqual(1);
    expect(r.capacityHours).toBe(r.provisionedCapacityUnits * 730);
    expect(r.ingressEventsMillions).toBeGreaterThan(0);
    expect(r.retentionOverageGb).toBeGreaterThanOrEqual(0);
    expect(r.lineItems.some((l) => l.meterId === "eh-standard-tu")).toBe(true);
    expect(
      r.lineItems.some((l) => l.meterId === "eh-standard-ingress-events"),
    ).toBe(true);
  });

  it("facade estimateAuditStream routes by provider", () => {
    const r = estimateAuditStream(
      "aws",
      {
        enabled: true,
        region: "us-east-1",
        ingressGBPerDay: 1,
        peakMBps: 1,
        peakEventsPerSec: 100,
        monthHours: 730,
      },
      awsRates,
    );
    expect(r.totals.expected).toBeGreaterThan(0);
  });
});

describe("package 06 — TEST fixtures vs bindings", () => {
  it("audit off → $0 for all providers", () => {
    for (const [fn, rates] of [
      [estimateAzureAuditStream, azureRates],
      [estimateAwsAuditStream, awsRates],
      [estimateGcpAuditStream, gcpRates],
    ] as const) {
      const r = fn(
        {
          enabled: false,
          region: "x",
          ingressGBPerDay: 100,
          peakMBps: 10,
          peakEventsPerSec: 5000,
        },
        rates,
      );
      expect(r.totals.expected).toBe(0);
      expect(r.lineItems).toEqual([]);
    }
  });

  it("Azure: 1 TU binding 1 MB/s or 1000 eps; 84 GB/TU included", () => {
    expect(sizeAzureEventHubTus({ peakMBps: 1, peakEventsPerSec: 0 })).toBe(1);
    expect(sizeAzureEventHubTus({ peakMBps: 0, peakEventsPerSec: 1000 })).toBe(
      1,
    );
    expect(sizeAzureEventHubTus({ peakMBps: 2.1, peakEventsPerSec: 0 })).toBe(
      3,
    );
    expect(AZURE_EH_INCLUDED_GB_PER_TU).toBe(84);
    const heavy = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        ingressGBPerDay: 50,
        peakMBps: 1,
        peakEventsPerSec: 1000,
        monthHours: 730,
      },
      azureRates,
    );
    expect(heavy.retentionOverageGb).toBeGreaterThan(0);
  });

  it("AWS Kinesis: shard sizing + PUT payload units", () => {
    expect(sizeKinesisShards({ peakMBps: 2, peakEventsPerSec: 500 })).toBe(2);
    expect(kinesisPutPayloadUnits(1)).toBeCloseTo((1024 * 1024) / 25);
    const r = estimateAwsAuditStream(
      {
        enabled: true,
        region: "us-east-1",
        orgPreset: "small",
        ingressGBPerDay: 0,
        peakMBps: 0,
        peakEventsPerSec: 0,
        monthHours: 730,
      },
      awsRates,
    );
    expect(r.lineItems.some((l) => l.meterId === "kinesis-shard-hour")).toBe(
      true,
    );
    expect(
      r.lineItems.some((l) => l.meterId === "kinesis-put-payload-units"),
    ).toBe(true);
    expect(r.totals.expected).toBeGreaterThan(0);
  });

  it("AWS PUT payload uses per-million list price (never × raw units)", () => {
    const r = estimateAwsAuditStream(
      {
        enabled: true,
        region: "us-east-1",
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
        monthHours: 730,
      },
      awsRates,
    );
    const put = r.lineItems.find(
      (l) => l.meterId === "kinesis-put-payload-units",
    );
    expect(put?.amount).toBeCloseTo(0.17860744533333336, 5);
    expect(put?.amount).toBeLessThan(1);
    expect(r.totals.expected).toBeCloseTo(11.128607445333333, 5);
  });

  it("GCP Pub/Sub: delivery + storage line items", () => {
    const r = estimateGcpAuditStream(
      {
        enabled: true,
        region: "us-central1",
        ingressGBPerDay: 5,
        peakMBps: 1,
        peakEventsPerSec: 1000,
        retentionDays: 7,
        monthHours: 730,
      },
      gcpRates,
    );
    expect(
      r.lineItems.some((l) => l.meterId === "pubsub-message-delivery"),
    ).toBe(true);
    expect(r.lineItems.some((l) => l.meterId === "pubsub-storage")).toBe(true);
  });
});

describe("package 06 — EDGE", () => {
  it("zero ingress still bills minimum unit when audit on", () => {
    const az = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        ingressGBPerDay: 0,
        peakMBps: 0,
        peakEventsPerSec: 0,
        monthHours: 730,
      },
      azureRates,
    );
    expect(az.provisionedCapacityUnits).toBe(1);
    expect(az.totals.expected).toBeCloseTo(1 * 0.03 * 730);
    expect(az.warnings.join(" ")).toMatch(/minimum 1 TU/i);

    const aws = estimateAwsAuditStream(
      {
        enabled: true,
        region: "us-east-1",
        ingressGBPerDay: 0,
        peakMBps: 0,
        peakEventsPerSec: 0,
        monthHours: 730,
      },
      awsRates,
    );
    expect(aws.provisionedCapacityUnits).toBe(1);
    expect(aws.totals.expected).toBeGreaterThan(0);
  });

  it("partition/shard topology count does not change capacity pricing", () => {
    const base = {
      enabled: true as const,
      region: "eastus",
      ingressGBPerDay: 1,
      peakMBps: 1,
      peakEventsPerSec: 1000,
      monthHours: 730,
    };
    const a = estimateAzureAuditStream(base, azureRates);
    const b = estimateAzureAuditStream(
      { ...base, partitionOrShardTopologyCount: 20 },
      azureRates,
    );
    expect(a.provisionedCapacityUnits).toBe(b.provisionedCapacityUnits);
    expect(a.totals.expected).toBeCloseTo(b.totals.expected);
    expect(b.notes.join(" ")).toMatch(/ignored for TU pricing/i);
  });

  it("Azure Capture meter never emitted", () => {
    const r = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        orgPreset: "large",
        ingressGBPerDay: 0,
        peakMBps: 0,
        peakEventsPerSec: 0,
      },
      azureRates,
    );
    expect(r.lineItems.every((l) => !/capture/i.test(l.meterId))).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Capture/i);
  });

  it("peakFactor scales capacity without multiplying average ingress volume", () => {
    const base = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
        peakFactor: 1,
        monthHours: 730,
      },
      azureRates,
    );
    const peaked = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
        peakFactor: 2,
        monthHours: 730,
      },
      azureRates,
    );
    expect(peaked.monthlyIngressGb).toBeCloseTo(base.monthlyIngressGb);
    expect(peaked.provisionedCapacityUnits).toBeGreaterThanOrEqual(
      base.provisionedCapacityUnits,
    );
  });

  it("missing meter price fails closed (no invented $0)", () => {
    expect(() =>
      estimateAzureAuditStream(
        {
          enabled: true,
          region: "eastus",
          ingressGBPerDay: 1,
          peakMBps: 1,
          peakEventsPerSec: 1,
        },
        { ...azureRates, unitPrices: {} },
      ),
    ).toThrow(/missing unit price/);
  });
});
