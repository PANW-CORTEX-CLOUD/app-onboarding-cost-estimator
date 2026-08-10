/**
 * Shared DSPM types — package 09.
 * Always emit low/expected/high bands (Low confidence) — never a false-precise single point.
 */
import type { Confidence, LineItem } from "../../core/models/estimate.types.ts";
export { requireRate } from "../../core/rates/require-rate.ts";

export type DspmInputs = {
  enabled: boolean;
  region: string;
  /** Total customer data estate (GB). */
  dataEstateGB: number;
  /** Percent of estate scanned per scan cycle (0–100). */
  pctScanned: number;
  scansPerMonth: number;
  /**
   * When true (Azure TF discovery empty / no telemetry), refuse silent precision
   * unless dataEstateGB was explicitly provided > 0 (EDGE).
   */
  discoveryTelemetryEmpty?: boolean;
  /**
   * Optional uplift for connector ephemeral compute (scanner VMs).
   * Off by default — must be explicit (EDGE).
   */
  includeEphemeralInfra?: boolean;
  /** Hours of ephemeral connector compute per scan when uplift enabled. Default 1. */
  ephemeralHoursPerScan?: number;
  /**
   * Average size of one scanned object, in MB.
   *
   * Object stores charge per API call, not per gigabyte, so this is what turns
   * an estate measured in bytes into a number of billable operations. It is a
   * property of the customer's data rather than of the cloud, so there is no
   * vendor figure to look up — see DEFAULT_AVG_OBJECT_SIZE_MB.
   */
  avgObjectSizeMB?: number;
};

export type DspmBand = {
  low: number;
  expected: number;
  high: number;
};

export type DspmResult = {
  lineItems: LineItem[];
  /** Always present when enabled — AC/TEST: no false-precise point quote. */
  totals: DspmBand;
  scannedGB: number;
  warnings: string[];
  notes: string[];
  confidence: "Low";
  /** UI must show Low confidence warning when enabled. */
  showLowConfidenceWarning: boolean;
};

/** Band uncertainty multipliers for Low-confidence DSPM. */
export const DSPM_BAND_LOW_FACTOR = 0.5;
export const DSPM_BAND_HIGH_FACTOR = 2.0;

export const DEFAULT_EPHEMERAL_HOURS_PER_SCAN = 1;

/**
 * Monthly data volume scanned: `dataEstateGB × (pctScanned / 100) × scansPerMonth`.
 * Linear in all three inputs — re-scanning the same estate N times per month
 * bills N times (v1 does not dedupe/cache prior scan coverage).
 * @throws when dataEstateGB/scansPerMonth is negative or pctScanned is outside 0–100.
 */
export function scannedGbFromInputs(inputs: DspmInputs): number {
  if (inputs.dataEstateGB < 0 || inputs.scansPerMonth < 0) {
    throw new Error("DSPM numeric inputs must be non-negative");
  }
  if (inputs.pctScanned < 0 || inputs.pctScanned > 100) {
    throw new Error(`pctScanned must be 0–100, got ${inputs.pctScanned}`);
  }
  return inputs.dataEstateGB * (inputs.pctScanned / 100) * inputs.scansPerMonth;
}

/**
 * Expand a Low-confidence point estimate into a low/expected/high band —
 * `low = expected × 0.5`, `high = expected × 2.0` (never a false-precise point, @see CLOUD_COST_MODEL.md confidence policy).
 */
export function bandFromExpected(expected: number): DspmBand {
  return {
    low: expected * DSPM_BAND_LOW_FACTOR,
    expected,
    high: expected * DSPM_BAND_HIGH_FACTOR,
  };
}
