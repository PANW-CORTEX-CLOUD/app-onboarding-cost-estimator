/**
 * Cost-driver explanations — number → meter → $ (package 34).
 * Formulas are display copy only; amounts always come from estimate.lineItems.
 */
import type { CloudProvider } from "../model/cloud-provider.ts";

export type DriverInputLink = {
  /** Visible label for the jump control. */
  label: string;
  /** Matches data-testid on the input. */
  inputTestId: string;
};

export type DriverCapabilityExplain = {
  formula: string;
  inputLinks: DriverInputLink[];
  /** Shown only for the top (largest $) driver. */
  peakNudge?: string;
};

export type DriverMeterRow = {
  meterId: string;
  amount: number;
  confidence: string;
};

const AUDIT_INPUTS: DriverInputLink[] = [
  { label: "Peak MB/s", inputTestId: "input-peak-mbps" },
  { label: "Peak events/s", inputTestId: "input-peak-eps" },
  { label: "Ingress GB/day", inputTestId: "input-ingress" },
  { label: "Audit storage GB", inputTestId: "input-avg-stored-gb" },
  { label: "Accounts", inputTestId: "input-account-count" },
];

const EXPLAIN: Record<
  CloudProvider,
  Partial<Record<string, DriverCapabilityExplain>>
> = {
  azure: {
    audit_logs: {
      formula:
        "1 TU ≈ 1 MB/s or 1000 events/s · TU-hours + ingress events + Hot LRS GB. Capture not in connector TF → not billed.",
      inputLinks: AUDIT_INPUTS,
      peakNudge:
        "If peak MB/s were 20% lower, capacity often drops a throughput-unit step.",
    },
    ads_cloud: {
      formula:
        "Snapshot GB-months from used disk × scans (modeled · no connector TF).",
      inputLinks: [
        { label: "VM count", inputTestId: "input-vm-count" },
        { label: "Avg used disk GB", inputTestId: "input-avg-disk-gb" },
        { label: "Scans / month", inputTestId: "input-scans-per-month" },
      ],
    },
    dspm: {
      formula:
        "Estate GB × % scanned × scans (modeled · no connector TF; Low confidence band).",
      inputLinks: [
        { label: "Data estate GB", inputTestId: "input-estate-main" },
        { label: "% scanned", inputTestId: "input-pct-scanned" },
        { label: "Scans / month", inputTestId: "input-scans-per-month" },
      ],
    },
    registry: {
      formula: "Image count × avg image GB × scans (pull bandwidth only).",
      inputLinks: [
        { label: "Image count", inputTestId: "input-image-count" },
        { label: "Avg image GB", inputTestId: "input-avg-image-gb" },
      ],
    },
    serverless: {
      formula: "Package count × scans (modeled · no connector TF).",
      inputLinks: [
        { label: "Package count", inputTestId: "input-package-count" },
      ],
    },
    egress: {
      formula: "Outbound GB leaving the region (modeled · no connector TF).",
      inputLinks: [{ label: "Egress GB", inputTestId: "input-egress-gb" }],
    },
  },
  aws: {
    audit_logs: {
      formula:
        "Shard-hours from peak + PUT payload units from ingress + S3 Standard storage. No connector TF — modeled defaults.",
      inputLinks: AUDIT_INPUTS,
      peakNudge:
        "If peak MB/s were 20% lower, shard count often drops a step.",
    },
    ads_cloud: {
      formula: "EBS snapshot-style used size × scans (modeled · no TF).",
      inputLinks: [
        { label: "VM count", inputTestId: "input-vm-count" },
        { label: "Avg used disk GB", inputTestId: "input-avg-disk-gb" },
      ],
    },
    dspm: {
      formula: "Estate scan band (modeled · no TF; Low confidence).",
      inputLinks: [
        { label: "Data estate GB", inputTestId: "input-estate-main" },
        { label: "% scanned", inputTestId: "input-pct-scanned" },
      ],
    },
    registry: {
      formula: "ECR pull bandwidth for scan images.",
      inputLinks: [
        { label: "Image count", inputTestId: "input-image-count" },
        { label: "Avg image GB", inputTestId: "input-avg-image-gb" },
      ],
    },
    serverless: {
      formula: "Lambda package scan volume (modeled).",
      inputLinks: [
        { label: "Package count", inputTestId: "input-package-count" },
      ],
    },
    egress: {
      formula: "Data transfer out (modeled).",
      inputLinks: [{ label: "Egress GB", inputTestId: "input-egress-gb" }],
    },
  },
  gcp: {
    audit_logs: {
      formula:
        "Pub/Sub delivery + retention storage + GCS Standard. No connector TF — modeled defaults.",
      inputLinks: AUDIT_INPUTS,
      peakNudge:
        "Lower ingress reduces delivery and retention storage together.",
    },
    ads_cloud: {
      formula: "PD snapshot used size × scans (modeled · no TF).",
      inputLinks: [
        { label: "VM count", inputTestId: "input-vm-count" },
        { label: "Avg used disk GB", inputTestId: "input-avg-disk-gb" },
      ],
    },
    dspm: {
      formula: "Estate scan band (modeled · no TF; Low confidence).",
      inputLinks: [
        { label: "Data estate GB", inputTestId: "input-estate-main" },
        { label: "% scanned", inputTestId: "input-pct-scanned" },
      ],
    },
    registry: {
      formula: "Artifact Registry pull for scan.",
      inputLinks: [
        { label: "Image count", inputTestId: "input-image-count" },
        { label: "Avg image GB", inputTestId: "input-avg-image-gb" },
      ],
    },
    serverless: {
      formula: "Cloud Run / Functions package scan (modeled).",
      inputLinks: [
        { label: "Package count", inputTestId: "input-package-count" },
      ],
    },
    egress: {
      formula: "Egress from region (modeled).",
      inputLinks: [{ label: "Egress GB", inputTestId: "input-egress-gb" }],
    },
  },
};

const FALLBACK_EXPLAIN: DriverCapabilityExplain = {
  formula: "See Breakdown for meter lines. No additional formula copy for this capability yet.",
  inputLinks: [],
};

/**
 * Group line items for one capability (unknown meters kept raw).
 */
export function metersForCapability(
  lineItems: Array<{ capability: string; meterId: string; amount: number; confidence: string }>,
  capability: string,
): DriverMeterRow[] {
  return lineItems
    .filter((li) => li.capability === capability)
    .map((li) => ({
      meterId: li.meterId,
      amount: li.amount,
      confidence: li.confidence,
    }));
}

export function explainDriver(
  provider: CloudProvider,
  capability: string,
): DriverCapabilityExplain {
  return EXPLAIN[provider]?.[capability] ?? FALLBACK_EXPLAIN;
}

/**
 * Focus + scroll an input by data-testid. Returns false if not in the DOM.
 */
export function jumpToInputTestId(inputTestId: string): boolean {
  const el = document.querySelector<HTMLElement>(
    `[data-testid="${inputTestId}"]`,
  );
  if (!el) return false;
  if (typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (typeof el.focus === "function") {
    el.focus({ preventScroll: true });
  }
  return true;
}
