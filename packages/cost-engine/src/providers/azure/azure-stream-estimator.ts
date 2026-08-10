/**
 * Azure Event Hubs Standard audit-stream estimator (package 06).
 *
 * Official bindings (Standard TU):
 * - 1 TU ≈ 1 MB/s ingress OR ~1000 events/sec
 * - 84 GB events included per TU per month
 * - TF defaults: capacity 1–20 TU auto-inflate, retention 7d, Capture not configured
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/event-hubs/
 * @see https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability
 */
import type { RateCard } from "../../core/models/estimate.types.ts";
import type { LineItem } from "../../core/models/estimate.types.ts";
import {
  DEFAULT_MONTH_HOURS,
  resolveMonthHours,
  scaleHourlyCost,
} from "../../core/hours.ts";
import { AZURE_TF_DEFAULTS } from "./capability-meter-map.ts";
import {
  DEFAULT_RETENTION_DAYS,
  applyOrgPreset,
  ASSUMED_EVENT_BYTES,
  gbToMillionEvents,
  monthlyIngressGb,
  requireRate,
  sumAmounts,
  type AuditStreamInputs,
  type AuditStreamResult,
} from "../streams/audit-stream.types.ts";

/** Included brokered volume per TU per month (official Standard). */
export const AZURE_EH_INCLUDED_GB_PER_TU = 84;

/** 1 TU ingress throughput binding. */
export const AZURE_EH_MBPS_PER_TU = 1;

/** 1 TU events/sec binding. */
export const AZURE_EH_EPS_PER_TU = 1000;

export const AZURE_EH_MIN_TU = 1;
export const AZURE_EH_MAX_TU = AZURE_TF_DEFAULTS.eventHubsMaxAutoInflateTu;

/**
 * Size TUs from peak throughput (after peakFactor on peaks only).
 * Min 1 when enabled; clamp to TF max auto-inflate.
 */
export function sizeAzureEventHubTus(opts: {
  peakMBps: number;
  peakEventsPerSec: number;
  peakFactor?: number;
}): number {
  const factor = opts.peakFactor ?? 1;
  if (factor < 1) {
    throw new Error(`peakFactor must be >= 1, got ${factor}`);
  }
  const peakMBps = opts.peakMBps * factor;
  const peakEps = opts.peakEventsPerSec * factor;
  const byMbps = Math.ceil(peakMBps / AZURE_EH_MBPS_PER_TU);
  const byEps = Math.ceil(peakEps / AZURE_EH_EPS_PER_TU);
  const needed = Math.max(byMbps, byEps, AZURE_EH_MIN_TU);
  return Math.min(Math.max(needed, AZURE_EH_MIN_TU), AZURE_EH_MAX_TU);
}

/**
 * Estimate Azure EH Standard monthly audit stream costs.
 * Does not emit Capture meters (TF captureConfigured=false).
 */
export function estimateAzureAuditStream(
  inputs: AuditStreamInputs,
  rates: RateCard,
): AuditStreamResult {
  if (rates.provider !== "azure") {
    throw new Error("estimateAzureAuditStream requires azure RateCard");
  }
  const warnings: string[] = [];
  const notes: string[] = [
    "Peak-hour / auto-inflate: TUs sized from peakMBps & peakEventsPerSec; billing is provisioned TU-hours (not instantaneous peak-only).",
    "Partition count is not a pricing unit — capacity uses Throughput Units.",
    "Azure Event Hubs Capture not in TF → no Capture meter line.",
  ];

  if (!inputs.enabled) {
    return emptyResult(notes);
  }

  const resolved = applyOrgPreset(inputs);
  const monthHours =
    resolved.monthHours ??
    resolveMonthHours({ convention: "730" }).monthHours ??
    DEFAULT_MONTH_HOURS;
  const retentionDays = resolved.retentionDays ?? DEFAULT_RETENTION_DAYS;

  const tus = sizeAzureEventHubTus({
    peakMBps: resolved.peakMBps,
    peakEventsPerSec: resolved.peakEventsPerSec,
    peakFactor: resolved.peakFactor,
  });

  // EDGE: zero ingress still bills minimum unit when audit on
  const capacityUnits = Math.max(tus, AZURE_EH_MIN_TU);
  if (
    resolved.ingressGBPerDay === 0 &&
    resolved.peakMBps === 0 &&
    resolved.peakEventsPerSec === 0
  ) {
    warnings.push(
      "audit enabled with zero ingress/peak — billing minimum 1 TU (no silent $0 capacity)",
    );
  }

  // EDGE: partition topology must not affect capacity pricing
  if (resolved.partitionOrShardTopologyCount !== undefined) {
    notes.push(
      `partitionOrShardTopologyCount=${resolved.partitionOrShardTopologyCount} ignored for TU pricing`,
    );
  }

  const tuRate = requireRate(rates.unitPrices, "eh-standard-tu");
  const ingressRate = requireRate(rates.unitPrices, "eh-standard-ingress-events");

  const capacityHours = capacityUnits * monthHours;
  let capacityAmount = scaleHourlyCost(capacityUnits, tuRate, monthHours);
  if (resolved.byoManagedStream) {
    capacityAmount = 0;
    notes.push(
      "BYO Event Hub: managed TU namespace/capacity cost zeroed (package 12)",
    );
  }

  const ingressGb = monthlyIngressGb(resolved.ingressGBPerDay, monthHours);
  // Peak factor must not multiply average ingress volume
  const eventBytes =
    resolved.assumedEventBytes ?? ASSUMED_EVENT_BYTES;
  const ingressMillions = gbToMillionEvents(ingressGb, eventBytes);
  const ingressAmount = ingressMillions * ingressRate;

  const includedGb = AZURE_EH_INCLUDED_GB_PER_TU * capacityUnits;
  const retentionOverageGb = Math.max(0, ingressGb - includedGb);
  // 84 GB/TU is the Standard included brokered volume binding — overage signals undersizing;
  // do not double-charge ingress events (ingress line already bills event volume).
  if (retentionOverageGb > 0) {
    warnings.push(
      `ingress ${ingressGb.toFixed(2)} GB exceeds ${includedGb} GB included (${AZURE_EH_INCLUDED_GB_PER_TU} GB/TU × ${capacityUnits} TU) — consider more TUs; overage tracked not double-billed`,
    );
  }
  if (retentionDays !== DEFAULT_RETENTION_DAYS) {
    notes.push(
      `retentionDays=${retentionDays} (TF default ${DEFAULT_RETENTION_DAYS}); Standard retention modeled with included 84 GB/TU allowance`,
    );
  }

  const lineItems: LineItem[] = [
    {
      provider: "azure",
      capability: "audit_logs",
      meterId: "eh-standard-tu",
      amount: capacityAmount,
      confidence: "High",
    },
    {
      provider: "azure",
      capability: "audit_logs",
      meterId: "eh-standard-ingress-events",
      amount: ingressAmount,
      confidence: "High",
    },
  ];

  // Guard: never emit Capture
  if (lineItems.some((l) => /capture/i.test(l.meterId))) {
    throw new Error("Capture meter must not be emitted");
  }

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    provisionedCapacityUnits: capacityUnits,
    capacityHours,
    ingressEventsMillions: ingressMillions,
    monthlyIngressGb: ingressGb,
    retentionOverageGb,
    warnings,
    notes,
    confidence: "High",
  };
}

function emptyResult(notes: string[]): AuditStreamResult {
  return {
    lineItems: [],
    totals: { expected: 0 },
    provisionedCapacityUnits: 0,
    capacityHours: 0,
    ingressEventsMillions: 0,
    monthlyIngressGb: 0,
    retentionOverageGb: 0,
    warnings: [],
    notes,
    confidence: "High",
  };
}
