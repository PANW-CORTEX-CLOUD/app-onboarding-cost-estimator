/**
 * Shared DSPM types — package 09.
 * Always emit low/expected/high bands (Low confidence) — never a false-precise single point.
 */
import type { Confidence, LineItem } from "../../core/models/estimate.types.ts";

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

export function scannedGbFromInputs(inputs: DspmInputs): number {
  if (inputs.dataEstateGB < 0 || inputs.scansPerMonth < 0) {
    throw new Error("DSPM numeric inputs must be non-negative");
  }
  if (inputs.pctScanned < 0 || inputs.pctScanned > 100) {
    throw new Error(`pctScanned must be 0–100, got ${inputs.pctScanned}`);
  }
  return inputs.dataEstateGB * (inputs.pctScanned / 100) * inputs.scansPerMonth;
}

export function bandFromExpected(expected: number): DspmBand {
  return {
    low: expected * DSPM_BAND_LOW_FACTOR,
    expected,
    high: expected * DSPM_BAND_HIGH_FACTOR,
  };
}
