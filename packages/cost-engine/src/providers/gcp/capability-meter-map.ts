/**
 * GCP Cortex capability → permission → meter map.
 * SSOT for research rows; must stay 1:1 with docs/CLOUD_COST_MODEL.md GCP table.
 * No local GCP TF yet — paths documented as stubs under gcp/.
 */
import type { CapabilityMeterRow } from "../meter-map.types.ts";
import { REQUIRED_CAPABILITIES } from "../meter-map.types.ts";

/** Planned GCP inventory root (stub README only until connector IaC lands). */
export const GCP_TF_INVENTORY_ROOT = "gcp";
export const GCP_TF_PRESENT = false;

/** Documented modeling defaults until gcp/ IaC exists. */
export const GCP_TF_DEFAULTS = {
  streamPrimary: "Pub/Sub",
  auditStorage: "Cloud Storage Standard",
  defaultRegion: "us-central1",
} as const;

export const gcpCapabilityMeterMap: readonly CapabilityMeterRow[] = [
  {
    capability: "discovery",
    capabilityLabel: "Discovery",
    permissionSignal: "IAM roles/viewer (or Cortex reader equivalent)",
    meterId: "none",
    meterSku: "n/a (permission-only)",
    unit: "n/a",
    confidence: "High",
    sourceUrl: "https://cloud.google.com/iam/docs/understanding-roles",
    notes: "No gcp/ TF yet — Discovery modeled $0",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (Pub/Sub)",
    permissionSignal: "Cloud Audit Logs → Pub/Sub topic",
    meterId: "pubsub-message-delivery",
    meterSku: "Pub/Sub message delivery / throughput",
    unit: "GiB",
    confidence: "High",
    sourceUrl: "https://cloud.google.com/pubsub/pricing",
    notes: "Default modeled stream: Pub/Sub",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (Pub/Sub storage)",
    permissionSignal: "Same as audit stream",
    meterId: "pubsub-storage",
    meterSku: "Pub/Sub message storage",
    unit: "GiB-month",
    confidence: "High",
    sourceUrl: "https://cloud.google.com/pubsub/pricing",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (GCS store)",
    permissionSignal: "storage.objects.create on audit bucket",
    meterId: "gcs-standard-storage",
    meterSku: "Cloud Storage Standard",
    unit: "GB-month",
    confidence: "High",
    sourceUrl: "https://cloud.google.com/storage/pricing",
  },
  {
    capability: "ads_cloud",
    capabilityLabel: "ADS Cloud",
    permissionSignal: "compute.snapshots.create for Cloud Scan",
    meterId: "pd-snapshot-storage",
    meterSku: "Persistent Disk snapshots (used size)",
    unit: "GB-month",
    confidence: "Med",
    sourceUrl: "https://cloud.google.com/compute/disks-image-pricing",
  },
  {
    capability: "ads_outpost",
    capabilityLabel: "ADS Outpost",
    permissionSignal: "compute.instances.create for outpost scanner",
    meterId: "gce-outpost-scanner",
    meterSku: "Compute Engine VM (outpost scanner)",
    unit: "hour",
    confidence: "Med",
    sourceUrl: "https://cloud.google.com/compute/vm-instance-pricing",
  },
  {
    capability: "dspm",
    capabilityLabel: "DSPM",
    permissionSignal: "GCS data reads + connector ephemeral infra",
    meterId: "gcs-data-read-band",
    meterSku: "Cloud Storage Class A/B ops + data (band)",
    unit: "GB + 10k-ops",
    confidence: "Low",
    sourceUrl: "https://cloud.google.com/storage/pricing",
  },
  {
    capability: "registry",
    capabilityLabel: "Registry scan",
    permissionSignal: "Artifact Registry pull for incremental scan",
    meterId: "artifact-registry-egress",
    meterSku: "Artifact Registry network egress (scan pull)",
    unit: "GB",
    confidence: "Low",
    sourceUrl: "https://cloud.google.com/artifact-registry/pricing",
  },
  {
    capability: "serverless",
    capabilityLabel: "Serverless scan",
    permissionSignal: "Cloud Run / Cloud Functions list+read for package scan",
    meterId: "cloud-run-scan-ops",
    meterSku: "Cloud Run / Cloud Functions (incremental scan)",
    unit: "vCPU-second + GiB-second",
    confidence: "Low",
    sourceUrl: "https://cloud.google.com/run/pricing",
  },
] as const;

export const GCP_BILLING_CATALOG_API_URL =
  "https://cloud.google.com/billing/docs/how-to/get-pricing-information-api";

export function assertGcpMapCoversRequiredCapabilities(): void {
  const present = new Set(gcpCapabilityMeterMap.map((r) => r.capability));
  for (const id of REQUIRED_CAPABILITIES) {
    if (!present.has(id)) {
      throw new Error(`GCP meter map missing capability: ${id}`);
    }
  }
}
