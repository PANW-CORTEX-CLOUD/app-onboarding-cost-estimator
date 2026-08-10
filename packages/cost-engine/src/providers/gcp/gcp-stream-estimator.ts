/**
 * GCP Pub/Sub audit-stream estimator (package 06).
 *
 * Bindings:
 * - Throughput billed primarily via message delivery GiB (no TU/shard capacity meter in map)
 * - Retained messages → pubsub-storage GiB-month
 * - Min capacity when audit on: at least retention storage for 1 day of ingress (fail closed ≠ $0)
 *
 * @see https://cloud.google.com/pubsub/pricing
 */
import type { RateCard, LineItem } from "../../core/models/estimate.types.ts";
import {
  DEFAULT_MONTH_HOURS,
  applyPeakFactor,
  resolveMonthHours,
} from "../../core/hours.ts";
import {
  DEFAULT_RETENTION_DAYS,
  applyOrgPreset,
  monthlyIngressGb,
  requireRate,
  sumAmounts,
  type AuditStreamInputs,
  type AuditStreamResult,
} from "../streams/audit-stream.types.ts";

/**
 * Decimal GB → binary GiB. Pub/Sub throughput and storage SKUs are both
 * denominated in GiB (2^30 bytes), while our volume inputs are decimal GB
 * (10^9 bytes) — 1 GB = (1000^3 / 1024^3) GiB ≈ 0.9313 GiB.
 * @see https://cloud.google.com/pubsub/pricing
 */
export function gbToGib(gb: number): number {
  return gb * (1000 ** 3 / 1024 ** 3);
}

/**
 * GCP Pub/Sub audit-stream monthly cost.
 *
 * Bills the two separate Pub/Sub meters (never conflated into one line):
 * - `pubsub-message-delivery`: monthly ingress GB → GiB × $/GiB (throughput).
 * - `pubsub-storage`: steady-state retained volume (dailyIngressGB × retentionDays)
 *   → GiB × $/GiB-month (message storage/retention).
 * Free tiers (10 GiB/month delivery, first 24h storage) are intentionally not
 * modeled — conservative estimate, consistent with the rest of this engine.
 *
 * @param inputs Audit stream volume/config. `enabled=false` → $0 (TEST).
 * @param rates GCP RateCard; must carry `pubsub-message-delivery` and `pubsub-storage`.
 * @returns Line items for both meters plus reporting fields (provisioned units,
 *   retention overage) — none of the reporting fields feed back into billing.
 * @see https://cloud.google.com/pubsub/pricing
 */
export function estimateGcpAuditStream(
  inputs: AuditStreamInputs,
  rates: RateCard,
): AuditStreamResult {
  if (rates.provider !== "gcp") {
    throw new Error("estimateGcpAuditStream requires gcp RateCard");
  }
  const warnings: string[] = [];
  const notes: string[] = [
    "Peak-hour note: peakFactor sizes throughput recommendation only; delivery GiB uses average ingressGB/day.",
    "Pub/Sub has no TU/shard pricing unit — partition hints are ignored.",
    "Minimum billable capacity when audit enabled: retention storage floor for one day of ingress.",
  ];

  if (!inputs.enabled) {
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

  const resolved = applyOrgPreset(inputs);
  const monthHours =
    resolved.monthHours ??
    resolveMonthHours({ convention: "730" }).monthHours ??
    DEFAULT_MONTH_HOURS;
  const retentionDays = resolved.retentionDays ?? DEFAULT_RETENTION_DAYS;

  // EDGE: negative ingress/retention would flow through gbToGib into a negative
  // deliveryAmount/storageAmount — a customer-facing estimate must never go negative.
  if (!Number.isFinite(resolved.ingressGBPerDay) || resolved.ingressGBPerDay < 0) {
    throw new Error(
      `ingressGBPerDay must be non-negative, got ${resolved.ingressGBPerDay}`,
    );
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error(`retentionDays must be non-negative, got ${retentionDays}`);
  }

  const peak = applyPeakFactor({
    averageVolume: Math.max(resolved.peakMBps, 0.001),
    peakFactor: resolved.peakFactor,
  });
  notes.push(
    `peakThroughputRecommendation=${peak.peakThroughputRecommendation.toFixed(3)} (MB/s scale); average ingress unchanged`,
  );

  if (resolved.partitionOrShardTopologyCount !== undefined) {
    notes.push(
      `partitionOrShardTopologyCount=${resolved.partitionOrShardTopologyCount} ignored (not a Pub/Sub pricing unit)`,
    );
  }

  const deliveryRate = requireRate(rates.unitPrices, "pubsub-message-delivery");
  const storageRate = requireRate(rates.unitPrices, "pubsub-storage");

  const ingressGb = monthlyIngressGb(resolved.ingressGBPerDay, monthHours);
  // Min capacity: if zero ingress, still bill a floor of 1 GiB-month storage when audit on
  let deliveryGib = gbToGib(ingressGb);
  let storageGib = gbToGib(resolved.ingressGBPerDay * retentionDays);
  let provisionedCapacityUnits = 0;

  if (ingressGb === 0) {
    warnings.push(
      "audit enabled with zero ingress — applying minimum 1 GiB-month Pub/Sub storage floor",
    );
    storageGib = Math.max(storageGib, 1);
    provisionedCapacityUnits = 1;
  } else {
    provisionedCapacityUnits = Math.max(1, Math.ceil(peak.peakThroughputRecommendation));
  }

  const deliveryAmount = deliveryGib * deliveryRate;
  let storageAmount = storageGib * storageRate;
  if (resolved.byoManagedStream) {
    // BYO Pub/Sub: zero managed topic storage / capacity floor; delivery still optional
    storageAmount = 0;
    provisionedCapacityUnits = 0;
    notes.push(
      "BYO Pub/Sub: managed storage/namespace capacity cost zeroed (package 12)",
    );
  }

  // Retention overage: storage beyond 7d default baseline for same daily ingress
  const baselineStorageGib = gbToGib(
    resolved.ingressGBPerDay * DEFAULT_RETENTION_DAYS,
  );
  const retentionOverageGb = resolved.byoManagedStream
    ? 0
    : Math.max(0, (storageGib - baselineStorageGib) / (1000 ** 3 / 1024 ** 3));

  const lineItems: LineItem[] = [
    {
      provider: "gcp",
      capability: "audit_logs",
      meterId: "pubsub-message-delivery",
      amount: deliveryAmount,
      confidence: "High",
    },
    {
      provider: "gcp",
      capability: "audit_logs",
      meterId: "pubsub-storage",
      amount: storageAmount,
      confidence: "High",
    },
  ];

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    provisionedCapacityUnits,
    capacityHours: monthHours,
    ingressEventsMillions: 0,
    monthlyIngressGb: ingressGb,
    retentionOverageGb,
    warnings,
    notes,
    confidence: "High",
  };
}
