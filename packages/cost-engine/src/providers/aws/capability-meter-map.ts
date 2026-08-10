/**
 * AWS Cortex capability → permission → meter map.
 * SSOT for research rows; must stay 1:1 with docs/CLOUD_COST_MODEL.md AWS table.
 * No local AWS TF yet — paths documented as stubs under aws/.
 */
import type { CapabilityMeterRow } from "../meter-map.types.ts";
import { REQUIRED_CAPABILITIES } from "../meter-map.types.ts";

/** Planned AWS inventory root (stub README only until connector IaC lands). */
export const AWS_TF_INVENTORY_ROOT = "aws";
export const AWS_TF_PRESENT = false;

/** Documented modeling defaults until aws/ IaC exists. */
export const AWS_TF_DEFAULTS = {
  streamPrimary: "Kinesis Data Streams",
  streamAlternate: "SQS",
  auditStorage: "S3 Standard",
  defaultRegion: "us-east-1",
} as const;

export const awsCapabilityMeterMap: readonly CapabilityMeterRow[] = [
  {
    capability: "discovery",
    capabilityLabel: "Discovery",
    permissionSignal: "IAM ReadOnlyAccess-style inventory roles",
    meterId: "none",
    meterSku: "n/a (permission-only)",
    unit: "n/a",
    confidence: "High",
    sourceUrl: "https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_job-functions.html",
    notes: "No aws/ TF yet — Discovery modeled $0",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (Kinesis)",
    permissionSignal: "CloudTrail / security findings → Kinesis stream",
    meterId: "kinesis-shard-hour",
    meterSku: "Kinesis Data Streams shard-hour",
    unit: "shard-hour",
    confidence: "High",
    sourceUrl: "https://aws.amazon.com/kinesis/data-streams/pricing/",
    notes: "Default modeled stream: Kinesis; SQS alternate when BYO queue",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (Kinesis PUT payload)",
    permissionSignal: "Same as audit stream",
    meterId: "kinesis-put-payload-units",
    meterSku: "Kinesis PUT Payload Units",
    unit: "million-payload-units",
    confidence: "High",
    sourceUrl: "https://aws.amazon.com/kinesis/data-streams/pricing/",
    notes: "List price is per million 25 KB PUT payload units — never × raw unit count",
  },
  {
    capability: "audit_logs",
    capabilityLabel: "Audit logs (S3 store)",
    permissionSignal: "s3:PutObject / GetObject on audit bucket",
    meterId: "s3-standard-storage",
    meterSku: "S3 Standard storage",
    unit: "GB-month",
    confidence: "High",
    sourceUrl: "https://aws.amazon.com/s3/pricing/",
  },
  {
    capability: "ads_cloud",
    capabilityLabel: "ADS Cloud",
    permissionSignal: "ec2:CreateSnapshot / DescribeVolumes for Cloud Scan",
    meterId: "ebs-snapshot-storage",
    meterSku: "EBS Snapshots (used size)",
    unit: "GB-month",
    confidence: "Med",
    sourceUrl: "https://aws.amazon.com/ebs/pricing/",
  },
  {
    capability: "ads_outpost",
    capabilityLabel: "ADS Outpost",
    permissionSignal: "EC2 run for outpost scanner",
    meterId: "ec2-outpost-scanner",
    meterSku: "Amazon EC2 (outpost scanner)",
    unit: "hour",
    confidence: "Med",
    sourceUrl: "https://aws.amazon.com/ec2/pricing/on-demand/",
  },
  {
    capability: "dspm",
    capabilityLabel: "DSPM",
    permissionSignal: "S3 data-plane reads + connector ephemeral infra",
    meterId: "s3-data-retrieval-band",
    meterSku: "S3 data retrieval / GET requests (band)",
    unit: "GB + 1k-requests",
    confidence: "Low",
    sourceUrl: "https://aws.amazon.com/s3/pricing/",
  },
  {
    capability: "registry",
    capabilityLabel: "Registry scan",
    permissionSignal: "ECR pull for incremental image scan",
    meterId: "ecr-data-transfer",
    meterSku: "ECR data transfer (scan pull)",
    unit: "GB",
    confidence: "Low",
    sourceUrl: "https://aws.amazon.com/ecr/pricing/",
  },
  {
    capability: "serverless",
    capabilityLabel: "Serverless scan",
    permissionSignal: "lambda:ListFunctions / GetFunction for package scan",
    meterId: "lambda-scan-ops",
    meterSku: "AWS Lambda (incremental scan)",
    unit: "GB-second + requests",
    confidence: "Low",
    sourceUrl: "https://aws.amazon.com/lambda/pricing/",
  },
] as const;

export const AWS_PRICE_LIST_API_URL =
  "https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html";

/**
 * Fail-closed coverage check: every `REQUIRED_CAPABILITIES` id must have at
 * least one row in `awsCapabilityMeterMap` (rows with `meterId: "none"` count
 * as intentionally-modeled $0, e.g. `discovery`). Throws on the first gap so a
 * capability can never silently ship with no AWS meter binding.
 */
export function assertAwsMapCoversRequiredCapabilities(): void {
  const present = new Set(awsCapabilityMeterMap.map((r) => r.capability));
  for (const id of REQUIRED_CAPABILITIES) {
    if (!present.has(id)) {
      throw new Error(`AWS meter map missing capability: ${id}`);
    }
  }
}
