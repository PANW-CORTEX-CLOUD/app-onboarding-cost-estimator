/**
 * Shared golden inputs for multi-cloud formula regression (package 14).
 * Fixtures commit expected totals; suites fail if capacity binding or
 * snapshot proration regresses.
 */
import type { RateCard } from "../../core/models/estimate.types.ts";

export const GOLDEN_MONTH_HOURS = 730;

export const GOLDEN_STREAM_INPUTS = {
  enabled: true as const,
  ingressGBPerDay: 10,
  peakMBps: 1,
  peakEventsPerSec: 1000,
  monthHours: GOLDEN_MONTH_HOURS,
};

export const GOLDEN_STORAGE_AVG_GB = 100;

export const GOLDEN_ADS_INPUTS = {
  enabled: true as const,
  mode: "cloud" as const,
  vmCount: 10,
  avgUsedDiskGB: 100,
  scansPerMonth: 4,
  snapshotLifetimeHours: 24,
  monthHours: GOLDEN_MONTH_HOURS,
};

/** Expected: 10×100×4×(24/730) = 131.50684931506848 GB-months */
export const GOLDEN_SNAPSHOT_GB_MONTHS = 131.50684931506848;

export const GOLDEN_AZURE_RATES: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "eh-standard-tu": 0.03,
    "eh-standard-ingress-events": 0.028,
    "blob-hot-lrs-capacity": 0.0208,
    "managed-disk-snapshot": 0.05,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

export const GOLDEN_AWS_RATES: RateCard = {
  provider: "aws",
  region: "us-east-1",
  currency: "USD",
  unitPrices: {
    "kinesis-shard-hour": 0.015,
    "kinesis-put-payload-units": 0.014,
    "s3-standard-storage": 0.023,
    "ebs-snapshot-storage": 0.05,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

export const GOLDEN_GCP_RATES: RateCard = {
  provider: "gcp",
  region: "us-central1",
  currency: "USD",
  unitPrices: {
    "pubsub-message-delivery": 0.04,
    "pubsub-storage": 0.27,
    "gcs-standard-storage": 0.02,
    "pd-snapshot-storage": 0.026,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};
