/**
 * Shared registry + serverless scan types (package 10).
 * Only incremental scan pull / ops — never existing registry or function storage.
 */
import type { Confidence, LineItem } from "../../core/models/estimate.types.ts";

export type RegistryScanInputs = {
  enabled: boolean;
  region: string;
  imageCount: number;
  avgImageGB: number;
  scansPerMonth: number;
  /**
   * Same-region pull → zero/minimal bandwidth (TEST).
   * Cross-region → apply egress uplift using registry meter rate.
   */
  crossRegionPull?: boolean;
};

export type ServerlessScanInputs = {
  enabled: boolean;
  region: string;
  packageCount: number;
  /** Average package / artifact size (GB) for bandwidth-ish meters. */
  avgPackageGB: number;
  scansPerMonth: number;
};

export type ScanEstimateResult = {
  lineItems: LineItem[];
  totals: { expected: number };
  warnings: string[];
  notes: string[];
  confidence: Confidence;
};

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
 * Incremental pull volume (GB) for registry scans:
 * `imageCount × avgImageGB × scansPerMonth`.
 * Each scan re-pulls every image at full size — v1 has no delta-layer
 * discount, matching the ADS "conservative full size per cycle" convention.
 * Billed only when the caller applies `crossRegionPull` (same-region pulls
 * are $0 — @see estimate-scan-core.ts).
 * @throws when imageCount, avgImageGB, or scansPerMonth is negative.
 */
export function registryPullGb(inputs: RegistryScanInputs): number {
  if (inputs.imageCount < 0 || inputs.avgImageGB < 0 || inputs.scansPerMonth < 0) {
    throw new Error("registry scan inputs must be non-negative");
  }
  return inputs.imageCount * inputs.avgImageGB * inputs.scansPerMonth;
}

/**
 * Serverless scan ops units: `packageCount × scansPerMonth`, mapped to
 * million-request-style meters by the caller (÷1e6 × rate).
 * NOTE: `avgPackageGB` is intentionally not billed here — meters for this
 * capability are ops/request-denominated (not GB-denominated); GB volume is
 * tracked in notes only (@see estimate-scan-core.ts). Do not multiply it in
 * without also switching to a GB-rate meter.
 * @throws when packageCount, avgPackageGB, or scansPerMonth is negative.
 */
export function serverlessScanOps(inputs: ServerlessScanInputs): number {
  if (
    inputs.packageCount < 0 ||
    inputs.avgPackageGB < 0 ||
    inputs.scansPerMonth < 0
  ) {
    throw new Error("serverless scan inputs must be non-negative");
  }
  return inputs.packageCount * inputs.scansPerMonth;
}
