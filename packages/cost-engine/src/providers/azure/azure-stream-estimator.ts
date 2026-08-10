/**
 * Azure Event Hubs Standard audit-stream estimator (package 06).
 *
 * Official bindings (Standard TU):
 * - 1 TU ≈ 1 MB/s ingress OR ~1000 events/sec
 * - 84 GB events included per TU per month
 * - Ingress events billed per-million; a message is 1 billable event under 64 KB,
 *   larger messages bill in 64 KB multiples (see AZURE_EH_INGRESS_EVENT_CHUNK_BYTES)
 * - TF defaults: capacity 1–20 TU auto-inflate, retention 7d, Capture not configured
 *
 * Two separate billable meters, both emitted every non-empty result:
 * `eh-standard-tu` (capacity, TU-hour) and `eh-standard-ingress-events`
 * (ingress volume, $/million events) — Azure bills these independently, so
 * neither may be zeroed/omitted while the other is non-zero (EDGE, see
 * `estimateAzureAuditStream`'s `byoManagedStream` handling below).
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

/**
 * Ingress events are billed per-message up to this size; a message larger
 * than 64 KB bills as `ceil(sizeBytes / 64KB)` events (official: "Each one is
 * a billable event. Larger messages are billed in multiples of 64 KB.").
 * @see https://azure.microsoft.com/en-us/pricing/details/event-hubs/
 */
export const AZURE_EH_INGRESS_EVENT_CHUNK_BYTES = 64 * 1024;

export const AZURE_EH_MIN_TU = 1;
export const AZURE_EH_MAX_TU = AZURE_TF_DEFAULTS.eventHubsMaxAutoInflateTu;

/**
 * Size Throughput Units from peak MB/s and peak events/sec.
 *
 * `tus = clamp(max(ceil(peakMBps × peakFactor / 1), ceil(peakEventsPerSec × peakFactor / 1000), 1), 1, maxAutoInflateTu)`
 *
 * A TU provides both bindings simultaneously (1 MB/s *and* 1000 events/sec),
 * so the larger of the two per-binding requirements sizes the namespace —
 * not the smaller (a namespace under-sized to only the lighter constraint
 * would throttle on the other). `peakFactor` scales both peaks uniformly
 * before sizing; it must never scale average ingress volume (see
 * `applyPeakFactor` in core/hours.ts).
 * @param opts.peakMBps Peak ingress throughput, MB/s (pre-peakFactor).
 * @param opts.peakEventsPerSec Peak ingress rate, events/sec (pre-peakFactor).
 * @param opts.peakFactor Throughput sizing multiplier, >=1. Default 1.
 * @returns TUs clamped to [`AZURE_EH_MIN_TU`, `AZURE_EH_MAX_TU`] (TF auto-inflate ceiling).
 * @throws when `peakFactor` < 1.
 * @see https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability
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
 * Estimate Azure Event Hubs Standard monthly audit-stream costs.
 *
 * Two independently-billed line items are always emitted together (never one
 * without the other) when `inputs.enabled`:
 * 1. **Capacity** (`eh-standard-tu`): `capacityUnits × tuRate × monthHours`
 *    (@see scaleHourlyCost) — TU-hour billing, zeroed only when `byoManagedStream`.
 * 2. **Ingress events** (`eh-standard-ingress-events`): monthly ingress GB is
 *    converted to an assumed message count (`gbToMillionEvents`), then scaled
 *    by the 64 KB billable-event multiplier (@see AZURE_EH_INGRESS_EVENT_CHUNK_BYTES)
 *    and multiplied by the $/million-events rate. This line is **not** zeroed
 *    by `byoManagedStream` — a customer-owned Event Hub still bills ingress
 *    events on the connector's stream, only the managed namespace capacity is BYO.
 *
 * Does not emit a Capture meter line (TF `captureConfigured=false`) — asserted
 * at the end of this function as a hard invariant, not just a warning.
 *
 * @param inputs Audit stream inputs; `enabled=false` short-circuits to a $0 result (TEST).
 * @param rates Azure RateCard — must carry provider "azure" (throws otherwise); requires
 *   `eh-standard-tu` and `eh-standard-ingress-events` (throws if missing, no invented $0).
 * @returns Line items (TU capacity + ingress events), totals, and capacity/ingress signals.
 * @see https://azure.microsoft.com/en-us/pricing/details/event-hubs/
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
  // EDGE: gbToMillionEvents derives an assumed *message* count (bytes/eventBytes).
  // Below 64 KB/message that equals the billable event count 1:1, but Azure bills
  // messages over 64 KB in multiples of 64 KB (AZURE_EH_INGRESS_EVENT_CHUNK_BYTES) —
  // without this multiplier a caller-supplied assumedEventBytes > 64KB would
  // silently undercount billable ingress events.
  const billableEventsPerMessage = Math.max(
    1,
    Math.ceil(eventBytes / AZURE_EH_INGRESS_EVENT_CHUNK_BYTES),
  );
  const ingressMillions =
    gbToMillionEvents(ingressGb, eventBytes) * billableEventsPerMessage;
  const ingressAmount = ingressMillions * ingressRate;

  const includedGb = AZURE_EH_INCLUDED_GB_PER_TU * capacityUnits;
  // EDGE: compares full *monthly* ingress (not a retention-window-scoped retained
  // volume) against the included-per-TU allowance — deliberately conservative
  // (flags undersizing earlier than a precise 84GB-was-sized-for-24h-retention
  // calc would), advisory only. 84 GB/TU is the Standard included brokered volume
  // binding — overage signals undersizing; do not double-charge ingress events
  // (ingress line already bills event volume).
  const retentionOverageGb = Math.max(0, ingressGb - includedGb);
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

  // Guard: never emit Capture (TF has no azurerm_eventhub Capture config — see
  // tf-audit-reconciliation.ts AZURE_TF_EXCLUDED_FROM_METERS).
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
