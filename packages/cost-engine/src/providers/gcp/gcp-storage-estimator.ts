/**
 * GCP Cloud Storage Standard audit-storage estimator (package 07).
 *
 * @see https://cloud.google.com/storage/pricing
 */
import type { RateCard, LineItem } from "../../core/models/estimate.types.ts";
import { GCP_TF_DEFAULTS } from "./capability-meter-map.ts";
import {
  assertAllowedRedundancy,
  requireRate,
  resolveCapacityGb,
  sumAmounts,
  type AuditStorageInputs,
  type AuditStorageResult,
} from "../storage/audit-storage.types.ts";

export const GCP_AUDIT_CAPACITY_METER = "gcs-standard-storage";
/** Class A (writes) / Class B (reads) — per 10k ops. */
export const GCP_AUDIT_WRITE_OPS_METER = "gcs-class-a-10k";
export const GCP_AUDIT_READ_OPS_METER = "gcs-class-b-10k";

export const GCP_ALLOWED_REDUNDANCY = ["STANDARD", "GCS_STANDARD"] as const;

/**
 * GCP Cloud Storage Standard audit-storage monthly cost.
 *
 * Cloud Storage capacity is priced per **GB-month** (decimal GB, not GiB) —
 * unlike Pub/Sub, no GB→GiB conversion is applied here. Formula:
 * `capacityCost = avgGB × $/GB-month` (steady-state stored capacity, no
 * lifecycle auto-delete assumed).
 * Optional Class A (write) / Class B (read) ops are billed per 10,000 ops,
 * matching the published Standard-class per-10k-operations rate.
 *
 * @param inputs Storage volume/config. `enabled=false` → $0 (TEST).
 * @param rates GCP RateCard; must carry `gcs-standard-storage` (and the ops
 *   meters when write/read ops are non-zero).
 * @returns capacityCost + opsCost line items; capacityGb floors to the shared
 *   DEFAULT_AUDIT_STORAGE_FLOOR_GB when avgGB is unset/0 (no silent $0).
 * @see https://cloud.google.com/storage/pricing
 */
export function estimateGcpAuditStorage(
  inputs: AuditStorageInputs,
  rates: RateCard,
): AuditStorageResult {
  if (rates.provider !== "gcp") {
    throw new Error("estimateGcpAuditStorage requires gcp RateCard");
  }
  const warnings: string[] = [];
  const notes: string[] = [
    `Modeled class: ${GCP_TF_DEFAULTS.auditStorage}`,
    "No lifecycle auto-delete assumed — avgGB is steady-state retained audit store.",
    "capacityCost = avgGB × gcs-standard-storage ($/GB-month).",
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

  assertAllowedRedundancy("gcp", GCP_ALLOWED_REDUNDANCY, inputs.redundancy);

  const capacityGb = resolveCapacityGb(true, inputs.avgGB, warnings);
  const capacityRate = requireRate(rates.unitPrices, GCP_AUDIT_CAPACITY_METER);
  const capacityCost = capacityGb * capacityRate;

  const writeOps = inputs.writeOpsPerMonth ?? 0;
  const readOps = inputs.readOpsPerMonth ?? 0;
  if (writeOps < 0 || readOps < 0) {
    throw new Error("write/read ops must be non-negative");
  }

  let opsCost = 0;
  const lineItems: LineItem[] = [
    {
      provider: "gcp",
      capability: "audit_logs",
      meterId: GCP_AUDIT_CAPACITY_METER,
      amount: capacityCost,
      confidence: "High",
    },
  ];

  if (writeOps > 0) {
    const writeRate = requireRate(rates.unitPrices, GCP_AUDIT_WRITE_OPS_METER);
    const writeAmount = (writeOps / 10_000) * writeRate;
    opsCost += writeAmount;
    lineItems.push({
      provider: "gcp",
      capability: "audit_logs",
      meterId: GCP_AUDIT_WRITE_OPS_METER,
      amount: writeAmount,
      confidence: "High",
    });
  }
  if (readOps > 0) {
    const readRate = requireRate(rates.unitPrices, GCP_AUDIT_READ_OPS_METER);
    const readAmount = (readOps / 10_000) * readRate;
    opsCost += readAmount;
    lineItems.push({
      provider: "gcp",
      capability: "audit_logs",
      meterId: GCP_AUDIT_READ_OPS_METER,
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
