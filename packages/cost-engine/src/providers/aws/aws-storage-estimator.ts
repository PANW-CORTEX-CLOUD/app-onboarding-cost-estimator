/**
 * AWS S3 Standard audit-storage estimator (package 07).
 *
 * @see https://aws.amazon.com/s3/pricing/
 */
import type { RateCard, LineItem } from "../../core/models/estimate.types.ts";
import { AWS_TF_DEFAULTS } from "./capability-meter-map.ts";
import {
  assertAllowedRedundancy,
  requireRate,
  resolveCapacityGb,
  sumAmounts,
  type AuditStorageInputs,
  type AuditStorageResult,
} from "../storage/audit-storage.types.ts";
import {
  priceQuantity,
  tieredPricingNote,
} from "../rates/tiered-rate.ts";

/** S3 Standard storage, billed per GB-month of average stored capacity. */
export const AWS_AUDIT_CAPACITY_METER = "s3-standard-storage";
/**
 * S3 PUT/COPY/POST/LIST requests. AWS prices these **per 1,000 requests**
 * (not per 10,000) — see `estimateAwsAuditStorage` for the divisor this feeds.
 */
export const AWS_AUDIT_WRITE_OPS_METER = "s3-put-1k";
/** S3 GET/SELECT requests, also priced per 1,000 requests. */
export const AWS_AUDIT_READ_OPS_METER = "s3-get-1k";

export const AWS_ALLOWED_REDUNDANCY = ["STANDARD", "S3_STANDARD"] as const;

/**
 * S3 Standard audit-log storage: capacity (GB-month) + optional request ops.
 *
 * - capacityCost = avgGB × `s3-standard-storage` ($/GB-month), floored to
 *   `DEFAULT_AUDIT_STORAGE_FLOOR_GB` when audit is enabled with avgGB unset/0.
 * - writeAmount = (writeOpsPerMonth / 1,000) × `s3-put-1k` ($/1,000 PUT/COPY/POST/LIST requests).
 * - readAmount = (readOpsPerMonth / 1,000) × `s3-get-1k` ($/1,000 GET/SELECT requests).
 *
 * @see https://aws.amazon.com/s3/pricing/ — "Requests & data retrievals" pricing is
 *   quoted per 1,000 requests (PUT/COPY/POST/LIST vs. GET/SELECT tiers), not per 10,000.
 * @param inputs Audit storage inputs; `enabled=false` short-circuits to a $0 result (TEST).
 * @param rates AWS RateCard — must carry provider "aws" (throws otherwise).
 * @returns Line items (capacity + any non-zero ops) and totals.
 */
export function estimateAwsAuditStorage(
  inputs: AuditStorageInputs,
  rates: RateCard,
): AuditStorageResult {
  if (rates.provider !== "aws") {
    throw new Error("estimateAwsAuditStorage requires aws RateCard");
  }
  const warnings: string[] = [];
  const notes: string[] = [
    `Modeled class: ${AWS_TF_DEFAULTS.auditStorage}`,
    "No lifecycle auto-delete assumed — avgGB is steady-state retained audit store.",
    "capacityCost = avgGB × s3-standard-storage ($/GB-month).",
  ];

  if (!inputs.enabled) {
    return {
      lineItems: [],
      totals: { expected: 0 },
      capacityGb: 0,
      capacityCost: 0,
      opsCost: 0,
      warnings: [],
      notes,
      confidence: "High",
    };
  }

  assertAllowedRedundancy("aws", AWS_ALLOWED_REDUNDANCY, inputs.redundancy);

  const capacityGb = resolveCapacityGb(true, inputs.avgGB, warnings);
  // Capacity is graduated on the clouds that publish a ladder; priceQuantity
  // charges each band at its own rate instead of the first band throughout.
  const capacityPrice = priceQuantity(rates, AWS_AUDIT_CAPACITY_METER, capacityGb);
  const capacityRate = capacityPrice.effectiveUnitPrice;
  const capacityCost = capacityPrice.amount;
  const capacityTierNote = tieredPricingNote(AWS_AUDIT_CAPACITY_METER, capacityPrice);
  if (capacityTierNote) notes.push(capacityTierNote);

  const writeOps = inputs.writeOpsPerMonth ?? 0;
  const readOps = inputs.readOpsPerMonth ?? 0;
  if (writeOps < 0 || readOps < 0) {
    throw new Error("write/read ops must be non-negative");
  }

  let opsCost = 0;
  const lineItems: LineItem[] = [
    {
      provider: "aws",
      capability: "audit_logs",
      meterId: AWS_AUDIT_CAPACITY_METER,
      amount: capacityCost,
      confidence: "High",
    },
  ];

  if (writeOps > 0) {
    const writeRate = requireRate(rates.unitPrices, AWS_AUDIT_WRITE_OPS_METER);
    // EDGE: S3 request pricing is $/1,000 requests, not $/10,000 — dividing by
    // 10,000 here would silently under-bill PUT/COPY/POST/LIST ops by 10x.
    const writeAmount = (writeOps / 1_000) * writeRate;
    opsCost += writeAmount;
    lineItems.push({
      provider: "aws",
      capability: "audit_logs",
      meterId: AWS_AUDIT_WRITE_OPS_METER,
      amount: writeAmount,
      confidence: "High",
    });
  }
  if (readOps > 0) {
    const readRate = requireRate(rates.unitPrices, AWS_AUDIT_READ_OPS_METER);
    const readAmount = (readOps / 1_000) * readRate;
    opsCost += readAmount;
    lineItems.push({
      provider: "aws",
      capability: "audit_logs",
      meterId: AWS_AUDIT_READ_OPS_METER,
      amount: readAmount,
      confidence: "High",
    });
  }

  return {
    lineItems,
    totals: { expected: sumAmounts(lineItems) },
    capacityGb,
    capacityCost,
    opsCost,
    warnings,
    notes,
    confidence: "High",
  };
}
