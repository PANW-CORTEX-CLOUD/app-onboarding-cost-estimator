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

export const AWS_AUDIT_CAPACITY_METER = "s3-standard-storage";
export const AWS_AUDIT_WRITE_OPS_METER = "s3-put-10k";
export const AWS_AUDIT_READ_OPS_METER = "s3-get-10k";

export const AWS_ALLOWED_REDUNDANCY = ["STANDARD", "S3_STANDARD"] as const;

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
    const writeAmount = (writeOps / 10_000) * writeRate;
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
    const readAmount = (readOps / 10_000) * readRate;
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
