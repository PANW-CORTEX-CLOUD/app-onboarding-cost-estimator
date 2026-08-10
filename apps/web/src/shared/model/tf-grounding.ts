/**
 * TF-grounding labels for cost-driver literacy (package 01/07).
 * Azure connector TF bills audit stream+store only; everything else is modeled.
 */
import type { CloudProvider } from "./cloud-provider.ts";

export type TfGroundingKind = "tf-grounded" | "modeled";

export function tfGroundingForCapability(
  provider: CloudProvider,
  capability: string,
): TfGroundingKind {
  if (provider === "azure" && capability === "audit_logs") {
    return "tf-grounded";
  }
  return "modeled";
}

export function tfGroundingLabel(kind: TfGroundingKind): string {
  return kind === "tf-grounded" ? "TF-grounded" : "Modeled · no TF";
}

/** Audit volume fields that feed audit_logs drivers (Affects chip sync). */
export const AUDIT_AFFECTS_FIELD_IDS = [
  "peakMBps",
  "peakEventsPerSec",
  "ingressGBPerDay",
  "avgStoredGB",
  "accountCount",
] as const;

export function capabilityForAffectsField(fieldId: string): string | null {
  if ((AUDIT_AFFECTS_FIELD_IDS as readonly string[]).includes(fieldId)) {
    return "audit_logs";
  }
  return null;
}

export function modeledCapsList(): string[] {
  return ["ADS", "DSPM", "Registry", "Serverless", "Egress"];
}
