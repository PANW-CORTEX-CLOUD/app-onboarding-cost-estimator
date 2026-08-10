/**
 * Provider-scoped “How billing works” copy (package 36).
 * Display-only; amounts stay on estimate line items.
 */
import type { CloudProvider } from "./cloud-provider.ts";

export type BillingHelpFamily = "audit" | "ads" | "dspm";

export type BillingHelpContent = {
  title: string;
  summary: string;
  meters: string[];
  pricingUrl: string;
  notes: string[];
};

const AUDIT: Record<CloudProvider, BillingHelpContent> = {
  azure: {
    title: "How Azure bills audit logs",
    summary:
      "Connector TF deploys Event Hubs Standard + blob LRS. Only those meters create customer-cloud cost.",
    meters: [
      "eh-standard-tu — Throughput Units (capacity)",
      "eh-standard-ingress-events — ingress events",
      "blob-hot-lrs-capacity — Hot LRS retained audit store",
    ],
    pricingUrl: "https://azure.microsoft.com/en-us/pricing/details/event-hubs/",
    notes: [
      "TF defaults: 1 TU, auto-inflate max 20, 7-day retention, Standard LRS.",
      "Partitions are topology only — not priced separately.",
      "Event Hubs Capture is not configured → no Capture meter.",
    ],
  },
  aws: {
    title: "How AWS bills audit logs (modeled)",
    summary:
      "No connector TF inventory yet — estimate uses Kinesis Data Streams + S3 Standard modeled defaults.",
    meters: [
      "kinesis-shard-hour — provisioned shards",
      "kinesis-put-payload-units — PUT payload units",
      "s3-standard-storage — retained audit objects",
    ],
    pricingUrl: "https://aws.amazon.com/kinesis/data-streams/pricing/",
    notes: [
      "Modeled defaults only — not grounded in deployable AWS connector IaC.",
    ],
  },
  gcp: {
    title: "How GCP bills audit logs (modeled)",
    summary:
      "No connector TF inventory yet — estimate uses Pub/Sub + GCS Standard modeled defaults.",
    meters: [
      "pubsub-message-delivery — message delivery",
      "pubsub-storage — topic retention storage",
      "gcs-standard-storage — retained audit objects",
    ],
    pricingUrl: "https://cloud.google.com/pubsub/pricing",
    notes: [
      "Modeled defaults only — not grounded in deployable GCP connector IaC.",
    ],
  },
};

const ADS: Record<CloudProvider, BillingHelpContent> = {
  azure: {
    title: "How ADS Cloud is modeled on Azure",
    summary:
      "Modeled · no connector TF — snapshot / scan path priced from VM + disk inputs.",
    meters: ["managed-disk-snapshot", "vm-outpost-scanner (Outpost only)"],
    pricingUrl: "https://azure.microsoft.com/en-us/pricing/details/managed-disks/",
    notes: ["Not deployed by azure/data audit/discovery TF."],
  },
  aws: {
    title: "How ADS is modeled on AWS",
    summary: "Modeled · no connector TF — EBS/EC2-style scan costs.",
    meters: ["ebs-snapshot / ec2 scanner (modeled)"],
    pricingUrl: "https://aws.amazon.com/ebs/pricing/",
    notes: ["No AWS connector TF inventory."],
  },
  gcp: {
    title: "How ADS is modeled on GCP",
    summary: "Modeled · no connector TF — PD snapshot / GCE scanner path.",
    meters: ["pd-snapshot / gce scanner (modeled)"],
    pricingUrl: "https://cloud.google.com/compute/disks-image-pricing",
    notes: ["No GCP connector TF inventory."],
  },
};

const DSPM: Record<CloudProvider, BillingHelpContent> = {
  azure: {
    title: "How DSPM is modeled on Azure",
    summary:
      "Modeled · no connector TF — Low-confidence band over estate GB × % scanned.",
    meters: ["blob-data-read-ops (band)"],
    pricingUrl: "https://azure.microsoft.com/en-us/pricing/details/storage/blobs/",
    notes: ["Requires dataEstateGB > 0 (fail closed in UI)."],
  },
  aws: {
    title: "How DSPM is modeled on AWS",
    summary: "Modeled · no connector TF — Low-confidence estate scan band.",
    meters: ["s3-data-scan (band)"],
    pricingUrl: "https://aws.amazon.com/s3/pricing/",
    notes: ["Requires dataEstateGB > 0."],
  },
  gcp: {
    title: "How DSPM is modeled on GCP",
    summary: "Modeled · no connector TF — Low-confidence estate scan band.",
    meters: ["gcs-data-scan (band)"],
    pricingUrl: "https://cloud.google.com/storage/pricing",
    notes: ["Requires dataEstateGB > 0."],
  },
};

/** Static copy lookup by provider + capability family — no calculation, no amounts. */
export function getBillingHelp(
  provider: CloudProvider,
  family: BillingHelpFamily,
): BillingHelpContent {
  if (family === "audit") return AUDIT[provider];
  if (family === "ads") return ADS[provider];
  return DSPM[provider];
}
