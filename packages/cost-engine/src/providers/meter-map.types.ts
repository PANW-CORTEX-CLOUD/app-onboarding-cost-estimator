/**
 * Provider meter-map row types for research / capability→meter SSOT.
 *
 * Lives under `providers/` (not `core/`) so Azure/AWS/GCP inventory facts
 * never leak into the generic domain core (package 01 EDGE).
 */

/** Cortex Cloud customer-infra capabilities modeled by the estimator. */
/**
 * Capabilities the estimator can price.
 *
 * `egress` was priced by all three estimators long before it appeared here,
 * which is exactly why it was missing from the capability maps and the docs:
 * the type made the omission unrepresentable in the map but not in the
 * estimator. providers/__tests__/meter-closure.test.ts now drives real
 * estimates and asserts every emitted meter is declared, so the two cannot
 * drift apart again.
 */
export type CapabilityId =
  | "discovery"
  | "audit_logs"
  | "ads_cloud"
  | "ads_outpost"
  | "dspm"
  | "registry"
  | "serverless"
  | "egress";

/** Quote confidence for UI honesty bands. */
export type Confidence = "High" | "Med" | "Low";

/**
 * One capability→permission→meter row for a single cloud provider.
 * Doc tables in docs/CLOUD_COST_MODEL.md must match these fields 1:1.
 */
export interface CapabilityMeterRow {
  /** Capability key shared across providers. */
  capability: CapabilityId;
  /** Human label for tables. */
  capabilityLabel: string;
  /** Cortex / IAM permission or role signal that enables the capability. */
  permissionSignal: string;
  /**
   * Provider meter id / SKU key used by rates adapters.
   * Use `none` when the capability has no billable customer-cloud meter ($0).
   */
  meterId: string;
  /** Display SKU / product name. */
  meterSku: string;
  /** Billing unit (e.g. hour, GB-month, million-events). */
  unit: string;
  confidence: Confidence;
  /** Official vendor documentation or pricing URL (must resolve live). */
  sourceUrl: string;
  /** Optional modeling note (TF default, Capture excluded, etc.). */
  notes?: string;
}

export const REQUIRED_CAPABILITIES: readonly CapabilityId[] = [
  "discovery",
  "audit_logs",
  "ads_cloud",
  "ads_outpost",
  "dspm",
  "registry",
  "serverless",
] as const;
