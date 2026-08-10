/**
 * AWS Kinesis Data Streams audit-stream estimator (package 06).
 *
 * Bindings (provisioned shard model for v1):
 * - 1 shard ≈ 1 MB/s ingress, ~1000 records/sec
 * - PUT Payload Unit = 25 KB chunk of ingress
 * - Rate card unitPrice is **per million** PUT payload units (AWS list price)
 * - Min 1 shard when audit enabled
 * - Partition/shard topology count ≠ pricing when passed as topology hint
 *
 * @see https://aws.amazon.com/kinesis/data-streams/pricing/
 */
import type { RateCard, LineItem } from "../../core/models/estimate.types.ts";
import {
  DEFAULT_MONTH_HOURS,
  resolveMonthHours,
  scaleHourlyCost,
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

/** Ingress throughput per shard — AWS: "1 MB/sec ingest per shard." */
export const AWS_KINESIS_MBPS_PER_SHARD = 1;
/** Record-rate limit per shard — AWS: "1,000 records/sec per shard" (binds independently of MB/s). */
export const AWS_KINESIS_EPS_PER_SHARD = 1000;
/** PUT Payload Unit chunk size — AWS bills each record rounded up to the nearest 25 KB. */
export const AWS_KINESIS_PUT_PAYLOAD_KB = 25;
/** Modeled floor: at least 1 shard is provisioned whenever audit streaming is enabled. */
export const AWS_KINESIS_MIN_SHARDS = 1;

/**
 * Provisioned-mode shard count for a given peak throughput.
 *
 * Kinesis shard capacity is bound by **two independent limits** — 1 MB/s ingest
 * and 1,000 records/sec — so the shard count must satisfy whichever limit is
 * more restrictive (`Math.max` of the two `Math.ceil` sizings), never just one.
 *
 * @param opts.peakMBps Peak ingress MB/s (pre-peakFactor).
 * @param opts.peakEventsPerSec Peak records/sec (pre-peakFactor).
 * @param opts.peakFactor Throughput sizing multiplier (>=1, default 1) — scales
 *   the capacity recommendation only, never the average billed volume.
 * @returns Shard count, floored at `AWS_KINESIS_MIN_SHARDS`.
 * @see https://aws.amazon.com/kinesis/data-streams/pricing/ — "one shard provides
 *   an ingest capacity of 1 MB/second or 1,000 records/second"
 */
export function sizeKinesisShards(opts: {
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
  const byMbps = Math.ceil(peakMBps / AWS_KINESIS_MBPS_PER_SHARD);
  const byEps = Math.ceil(peakEps / AWS_KINESIS_EPS_PER_SHARD);
  return Math.max(byMbps, byEps, AWS_KINESIS_MIN_SHARDS);
}

/**
 * PUT payload units for a month of ingress.
 *
 * Formula: `(monthlyIngressGb × 1024²) / 25` — total ingress bytes (GB treated
 * as GiB, matching this codebase's GB→bytes convention elsewhere, e.g.
 * `gbToMillionEvents`) divided into 25 KB payload-unit chunks.
 *
 * @remarks AWS actually meters PUT Payload Units **per record**, rounded up to
 * the nearest 25 KB chunk (a 1 KB record still costs 1 full unit). This
 * aggregate byte-total division approximates that and can under-count when the
 * average record is small relative to 25 KB — the model has no per-record size
 * input to do the per-record rounding exactly (v1 known limitation).
 * @param monthlyIngressGb Total ingress for the month, in GB (GiB convention).
 * @see https://aws.amazon.com/kinesis/data-streams/pricing/ — "A PUT Payload
 *   Unit is counted in 25 KB payload 'chunks' that comprise a record."
 */
export function kinesisPutPayloadUnits(monthlyIngressGb: number): number {
  const kb = monthlyIngressGb * 1024 * 1024;
  return kb / AWS_KINESIS_PUT_PAYLOAD_KB;
}

/**
 * Convert raw PUT payload units to millions — rate cards store $/million
 * (same convention as Azure `eh-standard-ingress-events`).
 * @see https://aws.amazon.com/kinesis/data-streams/pricing/ — PUT Payload Unit
 *   list price is quoted per million units.
 */
export function kinesisPutPayloadMillions(monthlyIngressGb: number): number {
  return kinesisPutPayloadUnits(monthlyIngressGb) / 1_000_000;
}

/**
 * AWS Kinesis Data Streams audit-log stream estimate.
 *
 * Two billing dimensions, summed:
 * 1. **Capacity**: `shards × kinesis-shard-hour × monthHours` (shard count from
 *    {@link sizeKinesisShards}, zeroed when `byoManagedStream` is set).
 * 2. **PUT payload**: `(monthlyIngressGb → payload units → millions) × kinesis-put-payload-units`
 *    via {@link kinesisPutPayloadUnits} — the rate is a **per-million** list price,
 *    so raw unit counts must never be multiplied by it directly (EDGE, regression-tested).
 *
 * Extended retention (beyond the 24h included window) is tracked only as an
 * informational `retentionOverageGb` signal in the result — it is **not** billed
 * as a line item in v1 (no `kinesis-extended-retention` meter is modeled; see
 * `capability-meter-map.ts` for the AWS meter SSOT).
 *
 * @param inputs Audit stream inputs; `enabled=false` short-circuits to a $0 result (TEST).
 * @param rates AWS RateCard — must carry provider "aws" (throws otherwise); requires
 *   `kinesis-shard-hour` and `kinesis-put-payload-units` (throws if missing, no invented $0).
 * @returns Line items (shard-hour + PUT payload), totals, and capacity/ingress signals.
 * @see https://aws.amazon.com/kinesis/data-streams/pricing/
 */
export function estimateAwsAuditStream(
  inputs: AuditStreamInputs,
  rates: RateCard,
): AuditStreamResult {
  if (rates.provider !== "aws") {
    throw new Error("estimateAwsAuditStream requires aws RateCard");
  }
  const warnings: string[] = [];
  const notes: string[] = [
    "Peak-hour billing note: shards provisioned from peak; billed as shard-hours for the month.",
    "Shard/partition topology hints are not the pricing unit — capacity uses shard-hours.",
    "SQS alternate path is out of scope for default Kinesis estimator (BYO in package 12).",
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

  const shards = sizeKinesisShards({
    peakMBps: resolved.peakMBps,
    peakEventsPerSec: resolved.peakEventsPerSec,
    peakFactor: resolved.peakFactor,
  });
  const capacityUnits = Math.max(shards, AWS_KINESIS_MIN_SHARDS);

  if (
    resolved.ingressGBPerDay === 0 &&
    resolved.peakMBps === 0 &&
    resolved.peakEventsPerSec === 0
  ) {
    warnings.push(
      "audit enabled with zero ingress/peak — billing minimum 1 Kinesis shard",
    );
  }
  if (resolved.partitionOrShardTopologyCount !== undefined) {
    notes.push(
      `partitionOrShardTopologyCount=${resolved.partitionOrShardTopologyCount} ignored for shard-hour pricing`,
    );
  }

  const shardRate = requireRate(rates.unitPrices, "kinesis-shard-hour");
  const putRate = requireRate(rates.unitPrices, "kinesis-put-payload-units");

  const capacityHours = capacityUnits * monthHours;
  let capacityAmount = scaleHourlyCost(capacityUnits, shardRate, monthHours);
  if (resolved.byoManagedStream) {
    capacityAmount = 0;
    notes.push(
      "BYO Kinesis: managed shard-hour namespace/capacity cost zeroed (package 12)",
    );
  }

  const ingressGb = monthlyIngressGb(resolved.ingressGBPerDay, monthHours);
  const putUnits = kinesisPutPayloadUnits(ingressGb);
  const putMillions = putUnits / 1_000_000;
  // EDGE: never multiply raw unit count by the per-million list price (×1e6 bug).
  const putAmount = putMillions * putRate;

  // Extended retention beyond 24h: modeled as note + overage GB retained (storage-like)
  // v1: retention overage = ingress retained across extra days beyond 1 (approx GB×days fraction)
  const extraRetentionDays = Math.max(0, retentionDays - 1);
  const retentionOverageGb =
    extraRetentionDays > 0 ? ingressGb * (extraRetentionDays / retentionDays) : 0;
  if (extraRetentionDays > 0) {
    notes.push(
      `retentionDays=${retentionDays}: first 24h included; extended retention approximated as ${retentionOverageGb.toFixed(2)} GB-overage signal (shard-hour meter remains capacity SSOT in v1)`,
    );
  }

  const lineItems: LineItem[] = [
    {
      provider: "aws",
      capability: "audit_logs",
      meterId: "kinesis-shard-hour",
      amount: capacityAmount,
      confidence: "High",
    },
    {
      provider: "aws",
      capability: "audit_logs",
      meterId: "kinesis-put-payload-units",
      amount: putAmount,
      confidence: "High",
    },
  ];

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    provisionedCapacityUnits: capacityUnits,
    capacityHours,
    ingressEventsMillions: putMillions,
    monthlyIngressGb: ingressGb,
    retentionOverageGb,
    warnings,
    notes,
    confidence: "High",
  };
}
