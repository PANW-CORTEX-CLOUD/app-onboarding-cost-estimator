/**
 * Azure TF ↔ meter ↔ retail reconciliation SSOT (packages 30–33).
 * Billable audit allowlist must match docs/TF_COST_RECONCILIATION.md.
 * Do not invent meters for auth rules, consumer groups, RG, diagnostics, Capture, or partitions.
 */
import { azureCapabilityMeterMap } from "./capability-meter-map.ts";

/** High-confidence meters grounded in azure/data AUDIT_LOGS TF. */
export const AZURE_TF_AUDIT_BILLABLE_METERS = [
  "eh-standard-tu",
  "eh-standard-ingress-events",
  "blob-hot-lrs-capacity",
] as const;

export type AzureTfAuditBillableMeter =
  (typeof AZURE_TF_AUDIT_BILLABLE_METERS)[number];

/**
 * Optional storage ops — only when write/read ops > 0 (not TF-invented Capture).
 * Allowed as a subset extension for audit-only breakdown AC.
 */
export const AZURE_TF_AUDIT_OPTIONAL_OPS_METERS = [
  "blob-hot-lrs-write-10k",
  "blob-hot-lrs-read-10k",
] as const;

/** Full allowlist for Azure audit-only breakdown ⊆ TF-faithful meters. */
export const AZURE_AUDIT_ONLY_METER_ALLOWLIST = [
  ...AZURE_TF_AUDIT_BILLABLE_METERS,
  ...AZURE_TF_AUDIT_OPTIONAL_OPS_METERS,
] as const;

/** Capabilities priced by the estimator without matching Azure connector TF. */
export const AZURE_MODELED_NO_TF_CAPABILITIES = [
  "ads_cloud",
  "ads_outpost",
  "dspm",
  "registry",
  "serverless",
  "egress",
] as const;

export type AzureModeledNoTfCapability =
  (typeof AZURE_MODELED_NO_TF_CAPABILITIES)[number];

/**
 * TF resources / artifacts that must not invent meters.
 * Keys are stable for EDGE tests; reasons are human-readable.
 */
export const AZURE_TF_EXCLUDED_FROM_METERS = [
  {
    resource: "azurerm_eventhub_namespace_authorization_rule",
    reason: "Auth config — no retail meter",
  },
  {
    resource: "azurerm_eventhub_consumer_group",
    reason: "Consumer group — no retail meter",
  },
  {
    resource: "azurerm_resource_group",
    reason: "Resource group container — no retail meter",
  },
  {
    resource: "azapi_resource cortex_mg_diagnostics",
    reason: "Diagnostics routing config — cost is EH+blob only",
  },
  {
    resource: "azurerm_user_assigned_identity",
    reason: "Identity-only — non-cost",
  },
  {
    resource: "azurerm_eventhub.partition_count",
    reason: "Partition topology ignored for TU pricing",
  },
  {
    resource: "Event Hubs Capture",
    reason: "Capture not configured in TF — meter forbidden",
  },
  {
    resource: "DISCOVERY-assets_discovery.tf",
    reason: "Empty file (0 bytes) → Discovery $0",
  },
] as const;

/** Warning substring for Azure modeled (non-TF) capabilities. */
export const AZURE_MODELED_NO_TF_WARNING_PREFIX =
  "Azure connector TF bills audit stream+store only; modeled · no connector TF:";

/** Single AWS/GCP honesty note (not per-toggle). */
export const NO_TF_INVENTORY_WARNING =
  "no TF inventory — modeled defaults";

/** Membership test against `AZURE_AUDIT_ONLY_METER_ALLOWLIST` (billable + optional ops meters). */
export function isAzureAuditOnlyMeterAllowed(meterId: string): boolean {
  return (AZURE_AUDIT_ONLY_METER_ALLOWLIST as readonly string[]).includes(
    meterId,
  );
}

/**
 * MeterIds for capability `audit_logs` on the Azure research map.
 * Must equal the three TF-billable meters (map may add labels but not Capture).
 */
export function azureAuditMapMeterIds(): AzureTfAuditBillableMeter[] {
  return azureCapabilityMeterMap
    .filter((r) => r.capability === "audit_logs")
    .map((r) => r.meterId) as AzureTfAuditBillableMeter[];
}

/**
 * Assert audit map meters match the reconciliation billable allowlist (order-insensitive).
 */
export function assertAzureAuditMapMatchesReconciliation(): void {
  // Both sides are compared as plain strings on purpose: the point of this
  // assertion is to catch a map that has drifted *outside* the allowlist, and
  // narrowing to the union first would make the compiler assume the very thing
  // being checked.
  const mapIds = new Set<string>(azureAuditMapMeterIds());
  const billable = new Set<string>(AZURE_TF_AUDIT_BILLABLE_METERS);
  if (mapIds.size !== billable.size) {
    throw new Error(
      `Azure audit map meter count ${mapIds.size} ≠ reconciliation ${billable.size}`,
    );
  }
  for (const id of billable) {
    if (!mapIds.has(id)) {
      throw new Error(
        `Azure audit map missing reconciliation meterId: ${id}`,
      );
    }
  }
  for (const id of mapIds) {
    if (!billable.has(id)) {
      throw new Error(
        `Azure audit map has meterId not in TF reconciliation: ${id}`,
      );
    }
  }
}
