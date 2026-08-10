/**
 * Shared audit-stream input types and org presets (package 06).
 * Provider formulas live under providers/{azure,aws,gcp}/*-stream-estimator.ts.
 */
import type { LineItem } from "../../core/models/estimate.types.ts";

export type OrgPresetId = "small" | "medium" | "large";

/** AC inputs for audit stream estimators. */
export type AuditStreamInputs = {
  /** When false → $0 line items (TEST). */
  enabled: boolean;
  region: string;
  /** Average ingress volume (GB/day). Peak factor must not silently multiply this. */
  ingressGBPerDay: number;
  /** Peak ingress MB/s for capacity sizing. */
  peakMBps: number;
  /** Peak events/sec for capacity sizing (EH/Kinesis binding). */
  peakEventsPerSec: number;
  /** Message retention days (TF default 7). */
  retentionDays?: number;
  monthHours?: number;
  /**
   * Average event size for GB→events conversion (Azure EH ingress events).
   * Default 1024 bytes — see ASSUMED_EVENT_BYTES.
   */
  assumedEventBytes?: number;
  /** Throughput sizing multiplier (>=1); does not multiply average ingress volume. */
  peakFactor?: number;
  /**
   * Azure partition count / AWS shard topology hint — NOT the pricing unit.
   * Capacity cost must ignore this (EDGE).
   */
  partitionOrShardTopologyCount?: number;
  orgPreset?: OrgPresetId;
  /**
   * BYO Event Hub / Kinesis / Pub/Sub (package 12) — zeros managed
   * namespace/capacity line amounts while ingress metering may still apply.
   */
  byoManagedStream?: boolean;
};

export type AuditStreamResult = {
  lineItems: LineItem[];
  totals: { expected: number };
  /** Provisioned pricing units (TU / shard / min PubSub capacity marker). */
  provisionedCapacityUnits: number;
  capacityHours: number;
  ingressEventsMillions: number;
  monthlyIngressGb: number;
  retentionOverageGb: number;
  warnings: string[];
  notes: string[];
  confidence: "High";
};

/** Org presets → volume signals (AC). */
export const ORG_STREAM_PRESETS: Record<
  OrgPresetId,
  Pick<AuditStreamInputs, "ingressGBPerDay" | "peakMBps" | "peakEventsPerSec">
> = {
  small: { ingressGBPerDay: 1, peakMBps: 0.25, peakEventsPerSec: 250 },
  medium: { ingressGBPerDay: 10, peakMBps: 1, peakEventsPerSec: 1000 },
  large: { ingressGBPerDay: 100, peakMBps: 10, peakEventsPerSec: 10_000 },
};

export function applyOrgPreset(
  inputs: AuditStreamInputs,
): AuditStreamInputs {
  if (!inputs.orgPreset) return inputs;
  const preset = ORG_STREAM_PRESETS[inputs.orgPreset];
  return {
    ...inputs,
    ingressGBPerDay: preset.ingressGBPerDay,
    peakMBps: preset.peakMBps,
    peakEventsPerSec: preset.peakEventsPerSec,
  };
}

export const DEFAULT_RETENTION_DAYS = 7;

/** Rough average event size for GB→events conversion when eps not used for volume. */
export const ASSUMED_EVENT_BYTES = 1024;

export function monthlyIngressGb(
  ingressGBPerDay: number,
  monthHours: number,
): number {
  const days = monthHours / 24;
  return ingressGBPerDay * days;
}

export function gbToMillionEvents(gb: number, eventBytes = ASSUMED_EVENT_BYTES): number {
  const events = (gb * 1024 ** 3) / eventBytes;
  return events / 1_000_000;
}

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
