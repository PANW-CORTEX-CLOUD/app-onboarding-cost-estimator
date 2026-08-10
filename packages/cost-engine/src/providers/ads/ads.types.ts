/**
 * Shared ADS (Agentless Disk Scanning) types — package 08.
 * Cloud = snapshot-only; Outpost = snapshots + scanner compute.
 */
import type { Confidence, LineItem } from "../../core/models/estimate.types.ts";

export type AdsMode = "Cloud" | "Outpost";

export type AdsInputs = {
  enabled: boolean;
  region: string;
  mode: AdsMode;
  /** Number of VMs / instances scanned. */
  vmCount: number;
  /** Average **used** disk size per VM (GB) — snapshot billing basis. */
  avgUsedDiskGB: number;
  /** Optional provisioned size — EDGE warns when provisioned >> used. */
  avgProvisionedDiskGB?: number;
  scansPerMonth: number;
  /** Snapshot retention lifetime for proration (hours). */
  snapshotLifetimeHours: number;
  monthHours?: number;
  /** Outpost scanner SKU label (documentation / export). */
  outpostVmSku?: string;
  /** Scanner compute hours per scan (Outpost). Default 2. */
  outpostHoursPerScan?: number;
  /**
   * Snapshot model. v1 default `full` (conservative used size).
   * `incremental` still bills full used size + warning (EDGE).
   */
  snapshotModel?: "full" | "incremental";
};

export type AdsResult = {
  lineItems: LineItem[];
  totals: { expected: number };
  snapshotGbMonths: number;
  snapshotCost: number;
  computeCost: number;
  warnings: string[];
  notes: string[];
  confidence: Confidence;
};

export const DEFAULT_OUTPOST_HOURS_PER_SCAN = 2;

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

export function sumAmounts(items: LineItem[]): number {
  return items.reduce((s, i) => s + i.amount, 0);
}

/** Detect Gov / restricted clouds for EDGE availability notes. */
export function isGovCloudRegion(region: string): boolean {
  const r = region.toLowerCase();
  return (
    r.includes("gov") ||
    r.includes("us-gov") ||
    r.includes("ffd") || // azure gov-ish
    r.startsWith("cn-") ||
    r.includes("fedramp")
  );
}

/**
 * Total snapshot GB-months from used-size × scans, prorated by lifetime/monthHours.
 * v1 conservative: full used size per scan (no incremental discount).
 */
export function snapshotGbMonthsUsedSize(opts: {
  vmCount: number;
  avgUsedDiskGB: number;
  scansPerMonth: number;
  snapshotLifetimeHours: number;
  monthHours: number;
}): number {
  const {
    vmCount,
    avgUsedDiskGB,
    scansPerMonth,
    snapshotLifetimeHours,
    monthHours,
  } = opts;
  if (vmCount < 0 || avgUsedDiskGB < 0 || scansPerMonth < 0) {
    throw new Error("ADS numeric inputs must be non-negative");
  }
  const rawGb = vmCount * avgUsedDiskGB * scansPerMonth;
  return rawGb * (snapshotLifetimeHours / monthHours);
}

export function collectAdsEdgeWarnings(inputs: AdsInputs): string[] {
  const warnings: string[] = [];
  if (inputs.enabled && inputs.vmCount === 0) {
    warnings.push(
      "ADS enabled with vmCount=0 — no snapshot volume; verify intentional (warn, not silent skip of toggle)",
    );
  }
  if (
    inputs.avgProvisionedDiskGB !== undefined &&
    inputs.avgProvisionedDiskGB > inputs.avgUsedDiskGB * 1.25
  ) {
    warnings.push(
      `provisioned disk ${inputs.avgProvisionedDiskGB} GB >> used ${inputs.avgUsedDiskGB} GB — billing uses used size only`,
    );
  }
  if (inputs.snapshotModel === "incremental") {
    warnings.push(
      "snapshotModel=incremental requested but v1 bills conservative full used size (no incremental discount)",
    );
  }
  return warnings;
}
