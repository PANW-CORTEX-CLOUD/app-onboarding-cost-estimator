/**
 * Official formula regression registry (package 14).
 * Each engine formula assertion is tied to an official provider documentation URL.
 * SSOT narrative: sources/OFFICIAL_FORMULA_CHECKS.md (must stay in sync — catalog test).
 */
import type { CloudProvider } from "../../core/models/estimate.types.ts";

export type FormulaCheckKind =
  | "capacity_binding"
  | "snapshot_proration"
  | "storage_capacity"
  | "other";

export type FormulaCheck = {
  id: string;
  provider: CloudProvider;
  title: string;
  officialUrl: string;
  kind: FormulaCheckKind;
};

/** Live vs fallback drift above this ratio → warn (EDGE); never auto-pass. */
export const LIVE_FALLBACK_DRIFT_WARN_RATIO = 0.3;

/** Env keys that must never silently skip formula regression (EDGE). */
export const FORBIDDEN_FORMULA_SKIP_ENV_KEYS = [
  "SKIP_FORMULA_CHECKS",
  "FORMULA_CHECKS_SKIP",
  "SKIP_OFFICIAL_FORMULA_CHECKS",
] as const;

/**
 * Executable assertions registry — ≥1 per major formula family × provider.
 */
export const FORMULA_CHECKS: readonly FormulaCheck[] = [
  // Azure
  {
    id: "azure-eh-tu-capacity-binding",
    provider: "azure",
    title: "Event Hubs Standard: 1 TU ≈ 1 MB/s or ~1000 events/sec",
    officialUrl:
      "https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability",
    kind: "capacity_binding",
  },
  {
    id: "azure-eh-included-gb-per-tu",
    provider: "azure",
    title: "Event Hubs Standard: 84 GB events included per TU per month",
    officialUrl: "https://azure.microsoft.com/en-us/pricing/details/event-hubs/",
    kind: "capacity_binding",
  },
  {
    id: "azure-blob-hot-lrs-capacity",
    provider: "azure",
    title: "Blob Hot LRS capacityCost = avgGB × $/GB-month",
    officialUrl:
      "https://azure.microsoft.com/en-us/pricing/details/storage/blobs/",
    kind: "storage_capacity",
  },
  {
    id: "azure-managed-disk-snapshot-proration",
    provider: "azure",
    title: "Managed Disk snapshot used-size × lifetimeHours/730",
    officialUrl:
      "https://azure.microsoft.com/en-us/pricing/details/managed-disks/",
    kind: "snapshot_proration",
  },
  // AWS
  {
    id: "aws-kinesis-shard-capacity-binding",
    provider: "aws",
    title: "Kinesis: 1 shard ≈ 1 MB/s ingress / ~1000 records/sec",
    officialUrl: "https://aws.amazon.com/kinesis/data-streams/pricing/",
    kind: "capacity_binding",
  },
  {
    id: "aws-s3-standard-capacity",
    provider: "aws",
    title: "S3 Standard capacityCost = avgGB × $/GB-month",
    officialUrl: "https://aws.amazon.com/s3/pricing/",
    kind: "storage_capacity",
  },
  {
    id: "aws-ebs-snapshot-proration",
    provider: "aws",
    title: "EBS snapshot used-size × lifetimeHours/730",
    officialUrl: "https://aws.amazon.com/ebs/pricing/",
    kind: "snapshot_proration",
  },
  // GCP
  {
    id: "gcp-pubsub-delivery-storage",
    provider: "gcp",
    title: "Pub/Sub message delivery GiB + storage GiB-month",
    officialUrl: "https://cloud.google.com/pubsub/pricing",
    kind: "capacity_binding",
  },
  {
    id: "gcp-gcs-standard-capacity",
    provider: "gcp",
    title: "GCS Standard capacityCost = avgGB × $/GB-month",
    officialUrl: "https://cloud.google.com/storage/pricing",
    kind: "storage_capacity",
  },
  {
    id: "gcp-pd-snapshot-proration",
    provider: "gcp",
    title: "PD snapshot used-size × lifetimeHours/730",
    officialUrl: "https://cloud.google.com/compute/disks-image-pricing",
    kind: "snapshot_proration",
  },
] as const;

export function formulaChecksForProvider(
  provider: CloudProvider,
): FormulaCheck[] {
  return FORMULA_CHECKS.filter((c) => c.provider === provider);
}

/**
 * Fail closed if forbidden skip env vars are set (EDGE — no silent bypass).
 */
export function assertFormulaChecksNotSkippedByEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of FORBIDDEN_FORMULA_SKIP_ENV_KEYS) {
    const v = env[key];
    if (v === undefined || v === "" || v === "0" || v.toLowerCase() === "false") {
      continue;
    }
    throw new Error(
      `Illegal silent bypass ${key}=${v} — formula regression must not be skipped via env`,
    );
  }
}

export type DriftCompareResult = {
  ratio: number;
  warn: boolean;
  /** Always false — drift must never auto-pass a check (EDGE). */
  autoPass: false;
};

/**
 * Compare a live unit price to fallback. Drift >30% → warn; never autoPass.
 */
export function liveVsFallbackDrift(
  liveUnitPrice: number,
  fallbackUnitPrice: number,
  warnRatio: number = LIVE_FALLBACK_DRIFT_WARN_RATIO,
): DriftCompareResult {
  if (
    !Number.isFinite(liveUnitPrice) ||
    !Number.isFinite(fallbackUnitPrice) ||
    fallbackUnitPrice <= 0
  ) {
    throw new Error(
      "liveVsFallbackDrift requires finite live price and positive fallback (fail closed)",
    );
  }
  if (liveUnitPrice < 0) {
    throw new Error("liveUnitPrice must be non-negative");
  }
  const ratio = Math.abs(liveUnitPrice - fallbackUnitPrice) / fallbackUnitPrice;
  return {
    ratio,
    warn: ratio > warnRatio,
    autoPass: false,
  };
}
