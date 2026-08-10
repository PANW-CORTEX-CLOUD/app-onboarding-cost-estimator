/**
 * Azure Cortex capability → permission → meter map.
 * SSOT for research rows; must stay 1:1 with docs/CLOUD_COST_MODEL.md Azure table.
 * Inventory defaults grounded in azure/data TF (unchanged).
 */
import type { CapabilityMeterRow } from "../meter-map.types.ts";
import { REQUIRED_CAPABILITIES } from "../meter-map.types.ts";

/** Azure TF inventory root (SSOT — do not mutate for estimator). */
export const AZURE_TF_INVENTORY_ROOT = "azure/data";

/** Defaults observed in azure/data AUDIT_LOGS TF (package 01 research). */
export const AZURE_TF_DEFAULTS = {
  eventHubsSku: "Standard",
  eventHubsCapacityTu: 1,
  eventHubsMaxAutoInflateTu: 20,
  eventHubsPartitionCount: 20,
  eventHubsRetentionDays: 7,
  auditStorageTier: "Standard",
  auditStorageReplication: "LRS",
  discoveryTfPath: "azure/data/DISCOVERY-assets_discovery.tf",
  discoveryTfEmpty: true,
  captureConfigured: false,
} as const;

/**
 * Azure capability → permission → meter SSOT rows — must equal
 * docs/CLOUD_COST_MODEL.md's "Azure capability → permission → meter" table
 * 1:1 (enforced by snapshot test, see providers/__tests__/capability-meter-map.test.ts).
 * `audit_logs` rows are the only ones grounded in real connector TF
 * (see tf-audit-reconciliation.ts); everything else is modeled, no connector TF.
 */
export const azureCapabilityMeterMap: readonly CapabilityMeterRow[] = [
  {
    capability: "discovery",
    capabilityLabel: "Discovery",
    permissionSignal: "Custom cortex-reader / Reader-style inventory roles (main.tf)",
    meterId: "none",
    meterSku: "n/a (permission-only)",
    unit: "n/a",
    confidence: "High",
    sourceUrl: "https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles",
    notes: "DISCOVERY-assets_discovery.tf is empty (0 bytes) → model Discovery as $0",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs",
    permissionSignal: "Azure Event Hubs Data Receiver + diagnostic settings → Event Hub",
    meterId: "eh-standard-tu",
    meterSku: "Event Hubs Standard Throughput Unit",
    unit: "TU-hour",
    confidence: "High",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/event-hubs/",
    notes:
      "TF: sku=Standard, capacity=1, auto_inflate max 20 TU, retention 7d, 84 GB/TU allowance; Capture not in TF → no Capture meter",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (ingress events)",
    permissionSignal: "Same as audit stream (EH ingress)",
    meterId: "eh-standard-ingress-events",
    meterSku: "Event Hubs Standard Ingress Events",
    unit: "million-events",
    confidence: "High",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/event-hubs/",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (blob store)",
    permissionSignal: "Storage Blob Data Contributor on audit storage account",
    meterId: "blob-hot-lrs-capacity",
    meterSku: "Blob Storage Standard LRS capacity",
    unit: "GB-month",
    confidence: "High",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/storage/blobs/",
    notes: "TF account_tier=Standard, account_replication_type=LRS",
  },
  {
    capability: "ads_cloud",
    capabilityLabel: "ADS Cloud",
    permissionSignal: "Disk snapshot / read permissions for Cloud Scan",
    meterId: "managed-disk-snapshot",
    meterSku: "Managed Disks Snapshots (used size)",
    unit: "GB-month",
    confidence: "Med",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/managed-disks/",
  },
  {
    capability: "ads_outpost",
    capabilityLabel: "ADS Outpost",
    permissionSignal: "Compute + disk access for outpost scanner VM",
    meterId: "vm-outpost-scanner",
    meterSku: "Virtual Machines (outpost scanner SKU)",
    unit: "hour",
    confidence: "Med",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/virtual-machines/linux/",
  },
  {
    capability: "dspm",
    capabilityLabel: "DSPM (object reads)",
    permissionSignal: "Data-plane read on blob estates + connector ephemeral infra",
    meterId: "blob-hot-lrs-read-10k",
    meterSku: "Blob Storage Hot LRS read operations (Get Blob)",
    unit: "10k-ops",
    confidence: "Low",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/storage/blobs/",
    notes: "Object stores bill scanning per operation, not per GB — hot/standard tiers have no retrieval fee. Estate GB is converted to objects via avgObjectSizeMB.",
  },
  {
    capability: "dspm",
    capabilityLabel: "DSPM (estate enumeration)",
    permissionSignal: "Data-plane read on blob estates + connector ephemeral infra",
    meterId: "blob-hot-lrs-list-10k",
    meterSku: "Blob Storage List Blobs (list + create container)",
    unit: "10k-ops",
    confidence: "Low",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/storage/blobs/",
    notes: "Azure Government DSPM availability may be N/A per Cortex — see EDGE gaps",
  },
  {
    capability: "registry",
    capabilityLabel: "Registry scan",
    permissionSignal: "ACR pull for incremental image scan",
    meterId: "acr-pull-bandwidth",
    meterSku: "Container Registry / bandwidth (scan pull)",
    unit: "GB",
    confidence: "Low",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/container-registry/",
    notes: "Do not bill existing registry storage — incremental scan pull only",
  },
  {
    capability: "serverless",
    capabilityLabel: "Serverless scan",
    permissionSignal: "Function App list/read for package scan",
    meterId: "functions-scan-ops",
    meterSku: "Azure Functions (incremental scan ops / bandwidth)",
    unit: "GB + million-exec",
    confidence: "Low",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/functions/",
  },
  {
    capability: "egress",
    capabilityLabel: "Egress / data transfer",
    permissionSignal: "Network egress permitted by connector NSG / routing",
    meterId: "azure-egress-gb",
    meterSku: "Bandwidth data transfer out",
    unit: "GB",
    confidence: "Low",
    sourceUrl: "https://azure.microsoft.com/en-us/pricing/details/bandwidth/",
    notes: "Toggle off → $0. Unknown destination zone is excluded and warned rather than guessed; cross-cloud transfer is never free.",
  },
] as const;

/** Retail Prices API (rates module later) — cited for official pricing source. */
export const AZURE_RETAIL_PRICES_API_URL =
  "https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices";

/**
 * @throws when any capability in `REQUIRED_CAPABILITIES` (core/meter-map.types.ts)
 * has no row in `azureCapabilityMeterMap` — catches an accidental drop of an
 * entire capability from the Azure research map (not a per-meter check).
 */
export function assertAzureMapCoversRequiredCapabilities(): void {
  const present = new Set(azureCapabilityMeterMap.map((r) => r.capability));
  for (const id of REQUIRED_CAPABILITIES) {
    if (!present.has(id)) {
      throw new Error(`Azure meter map missing capability: ${id}`);
    }
  }
}
