/**
 * Shared audit-storage types (package 07).
 * Provider formulas: providers/{azure,aws,gcp}/*-storage-estimator.ts
 */
import type { LineItem } from "../../core/models/estimate.types.ts";
export { requireRate } from "../../core/rates/require-rate.ts";

/*
 * There was a `StorageRedundancy` union here. It was referenced nowhere, and
 * its members ("Standard") did not match what the providers actually enforce
 * ("STANDARD", via each `*_ALLOWED_REDUNDANCY` array) — so a reader who trusted
 * it would have been misled. `assertAllowedRedundancy` takes `readonly
 * string[]` and normalises case, so the type added no safety either. Deleted
 * rather than left as a decoration.
 */

export type AuditStorageInputs = {
  /** When false → $0 (TEST). */
  enabled: boolean;
  region: string;
  /**
   * Average stored capacity (GB-month). When audit enabled and unset/0,
   * DEFAULT_AUDIT_STORAGE_FLOOR_GB applies (AC).
   */
  avgGB?: number;
  /** Write operations per month (provider ops units — typically 10k batches in formula). */
  writeOpsPerMonth?: number;
  /** Read operations per month. */
  readOpsPerMonth?: number;
  /**
   * Redundancy / storage class. Default = TF-aligned LRS / S3 Standard / GCS Standard.
   * GRS/ZRS/Multi-region → throw (EDGE) unless listed here and handled.
   */
  redundancy?: string;
};

export type AuditStorageResult = {
  lineItems: LineItem[];
  totals: { expected: number };
  capacityGb: number;
  capacityCost: number;
  opsCost: number;
  warnings: string[];
  notes: string[];
  confidence: "High";
};

/** Floor capacity when audit is on but avgGB omitted/zero (AC). */
export const DEFAULT_AUDIT_STORAGE_FLOOR_GB = 1;

/**
 * Resolve billable stored capacity (GB-month). `avgGB` (when > 0) wins;
 * unset or exactly 0 falls back to `DEFAULT_AUDIT_STORAGE_FLOOR_GB` with a
 * warning — never a silent $0 while audit storage is enabled.
 * @returns 0 when `!enabled` (no warning pushed).
 * @throws when `avgGB` is negative — a negative capacity is invalid input,
 *   not "unset" (matches the writeOps/readOps negative check in the
 *   provider estimators, which throw rather than substitute a floor).
 */
export function resolveCapacityGb(
  enabled: boolean,
  avgGB: number | undefined,
  warnings: string[],
): number {
  if (!enabled) return 0;
  if (avgGB !== undefined && avgGB < 0) {
    throw new Error(`avgGB must be non-negative, got ${avgGB}`);
  }
  if (avgGB !== undefined && avgGB > 0) return avgGB;
  warnings.push(
    `audit storage enabled with avgGB=${avgGB ?? "unset"} — applying floor ${DEFAULT_AUDIT_STORAGE_FLOOR_GB} GB (no silent $0 capacity)`,
  );
  return DEFAULT_AUDIT_STORAGE_FLOOR_GB;
}

/** Sum of `LineItem.amount` across all items — plain linear total, no dedup. */
export function sumAmounts(items: LineItem[]): number {
  return items.reduce((s, i) => s + i.amount, 0);
}

/**
 * Fail closed on non-standard redundancy (EDGE).
 * @param allowed Canonical values for this provider (e.g. LRS).
 * @param selected User/input redundancy (default = first allowed).
 */
export function assertAllowedRedundancy(
  provider: string,
  allowed: readonly string[],
  selected: string | undefined,
): string {
  const value = (selected ?? allowed[0]).toUpperCase().replace(/-/g, "_");
  const allowedNorm = allowed.map((a) => a.toUpperCase().replace(/-/g, "_"));
  if (!allowedNorm.includes(value)) {
    throw new Error(
      `${provider} audit storage redundancy '${selected}' is not supported in v1 ` +
        `(allowed: ${allowed.join(", ")}). Non-standard redundancy (GRS/ZRS/Multi-region) fails closed.`,
    );
  }
  return value;
}
