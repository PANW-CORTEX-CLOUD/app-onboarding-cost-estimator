/**
 * Shared audit-storage types (package 07).
 * Provider formulas: providers/{azure,aws,gcp}/*-storage-estimator.ts
 */
import type { LineItem } from "../../core/models/estimate.types.ts";

/** Supported redundancy — anything else fails closed unless explicitly allowlisted later. */
export type StorageRedundancy =
  | "LRS"
  | "Standard"
  | "S3_STANDARD"
  | "GCS_STANDARD";

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
 * otherwise falls back to `DEFAULT_AUDIT_STORAGE_FLOOR_GB` with a warning —
 * never a silent $0 while audit storage is enabled.
 * @returns 0 when `!enabled` (no warning pushed).
 */
export function resolveCapacityGb(
  enabled: boolean,
  avgGB: number | undefined,
  warnings: string[],
): number {
  if (!enabled) return 0;
  if (avgGB !== undefined && avgGB > 0) return avgGB;
  warnings.push(
    `audit storage enabled with avgGB=${avgGB ?? "unset"} — applying floor ${DEFAULT_AUDIT_STORAGE_FLOOR_GB} GB (no silent $0 capacity)`,
  );
  return DEFAULT_AUDIT_STORAGE_FLOOR_GB;
}

/**
 * Look up a meter's unit price, failing closed instead of defaulting to $0.
 * @throws when `meterId` is absent from `unitPrices`.
 */
export function requireRate(
  unitPrices: Record<string, number>,
  meterId: string,
): number {
  const p = unitPrices[meterId];
  if (p === undefined) {
    throw new Error(`missing unit price for meter '${meterId}' (no invented $0)`);
  }
  return p;
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
