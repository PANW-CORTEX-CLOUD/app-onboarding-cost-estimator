/**
 * Azure Blob Hot LRS audit-storage estimator (package 07).
 * Grounded in azure/data TF: Standard + LRS. No lifecycle auto-delete assumed.
 *
 * @see https://azure.microsoft.com/en-us/pricing/details/storage/blobs/
 */
import type { RateCard, LineItem } from "../../core/models/estimate.types.ts";
import { AZURE_TF_DEFAULTS } from "./capability-meter-map.ts";
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

export const AZURE_AUDIT_CAPACITY_METER = "blob-hot-lrs-capacity";
/** Optional ops meters (per 10k operations) — required in RateCard when ops > 0. */
export const AZURE_AUDIT_WRITE_OPS_METER = "blob-hot-lrs-write-10k";
export const AZURE_AUDIT_READ_OPS_METER = "blob-hot-lrs-read-10k";

export const AZURE_ALLOWED_REDUNDANCY = ["LRS"] as const;

export function estimateAzureAuditStorage(
  inputs: AuditStorageInputs,
  rates: RateCard,
): AuditStorageResult {
  if (rates.provider !== "azure") {
    throw new Error("estimateAzureAuditStorage requires azure RateCard");
  }
  const warnings: string[] = [];
  const notes: string[] = [
    `TF defaults: tier=${AZURE_TF_DEFAULTS.auditStorageTier}, replication=${AZURE_TF_DEFAULTS.auditStorageReplication}`,
    "No lifecycle auto-delete assumed — avgGB is steady-state retained audit store.",
    "capacityCost = avgGB × blob-hot-lrs-capacity ($/GB-month).",
  ];

  if (!inputs.enabled) {
    return empty(notes);
  }

  assertAllowedRedundancy("azure", AZURE_ALLOWED_REDUNDANCY, inputs.redundancy);

  const capacityGb = resolveCapacityGb(true, inputs.avgGB, warnings);
  // Capacity is graduated on the clouds that publish a ladder; priceQuantity
  // charges each band at its own rate instead of the first band throughout.
  const capacityPrice = priceQuantity(rates, AZURE_AUDIT_CAPACITY_METER, capacityGb);
  const capacityRate = capacityPrice.effectiveUnitPrice;
  const capacityCost = capacityPrice.amount;
  const capacityTierNote = tieredPricingNote(AZURE_AUDIT_CAPACITY_METER, capacityPrice);
  if (capacityTierNote) notes.push(capacityTierNote);

  const writeOps = inputs.writeOpsPerMonth ?? 0;
  const readOps = inputs.readOpsPerMonth ?? 0;
  if (writeOps < 0 || readOps < 0) {
    throw new Error("write/read ops must be non-negative");
  }

  let opsCost = 0;
  const lineItems: LineItem[] = [
    {
      provider: "azure",
      capability: "audit_logs",
      meterId: AZURE_AUDIT_CAPACITY_METER,
      amount: capacityCost,
      confidence: "High",
    },
  ];

  if (writeOps > 0) {
    const writeRate = requireRate(rates.unitPrices, AZURE_AUDIT_WRITE_OPS_METER);
    const writeAmount = (writeOps / 10_000) * writeRate;
    opsCost += writeAmount;
    lineItems.push({
      provider: "azure",
      capability: "audit_logs",
      meterId: AZURE_AUDIT_WRITE_OPS_METER,
      amount: writeAmount,
      confidence: "High",
    });
  }
  if (readOps > 0) {
    const readRate = requireRate(rates.unitPrices, AZURE_AUDIT_READ_OPS_METER);
    const readAmount = (readOps / 10_000) * readRate;
    opsCost += readAmount;
    lineItems.push({
      provider: "azure",
      capability: "audit_logs",
      meterId: AZURE_AUDIT_READ_OPS_METER,
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

function empty(notes: string[]): AuditStorageResult {
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
