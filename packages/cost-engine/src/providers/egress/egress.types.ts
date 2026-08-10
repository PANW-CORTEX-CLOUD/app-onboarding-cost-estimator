/**
 * Egress / cross-cloud bandwidth types (package 11).
 * Never assume free cross-cloud; unknown zones exclude + warn (EDGE).
 */
import type { Confidence, LineItem } from "../../core/models/estimate.types.ts";

export type EgressInputs = {
  /** AC: "Include estimated egress" toggle — false → $0. */
  enabled: boolean;
  /** Source region (provider commercial vs Gov). */
  region: string;
  /**
   * Destination zone/region key for rate-card lookup
   * (e.g. `internet`, `us-west-2`, `europe`, `cross-cloud`).
   */
  destinationZone: string;
  /**
   * Explicit monthly egress GB. When omitted, defaults from
   * auditStreamIngressGBPerMonth (AC: audit default from stream ingress).
   */
  egressGB?: number;
  /** Monthly stream ingress GB — default egress volume when egressGB unset. */
  auditStreamIngressGBPerMonth?: number;
  /**
   * Private Link / VPC Endpoints path — reduces billed egress (EDGE).
   */
  privateLinkOrVpcEndpoint?: boolean;
  /** Remaining egress fraction when private path enabled (default 0.1). */
  privatePathEgressFactor?: number;
  /**
   * When true, do not bill — another meter already covers this egress
   * (TEST: no double-count with stream/registry egress meters).
   */
  alreadyBilledElsewhere?: boolean;
};

export type EgressResult = {
  lineItems: LineItem[];
  totals: { expected: number };
  billedEgressGB: number;
  ratePerGb: number | null;
  warnings: string[];
  notes: string[];
  confidence: Confidence;
  /** True when destination was unknown and egress excluded. */
  excludedUnknownZone: boolean;
};

/**
 * Look up a meter's unit price, failing closed instead of defaulting to $0.
 * @throws when `meterId` is absent from `unitPrices`.
 */
export function requireRate(
  unitPrices: Record<string, number>,
  meterId: string,
): number {
  const p = unitPrices[meterId];
  if (p === undefined) {
    throw new Error(`missing unit price for meter '${meterId}' (no invented $0)`);
  }
  return p;
}

/** Sum of `LineItem.amount` across all items — plain linear total, no dedup. */
export function sumAmounts(items: LineItem[]): number {
  return items.reduce((s, i) => s + i.amount, 0);
}

/**
 * Resolve billed egress volume: explicit `egressGB` wins; otherwise falls
 * back to `auditStreamIngressGBPerMonth` (audit stream's ingress volume,
 * assumed egressed 1:1 to Cortex). Neither present → fail closed.
 * @throws when `egressGB` is negative, or when both inputs are unset.
 */
export function resolveEgressGb(inputs: EgressInputs): number {
  if (inputs.egressGB !== undefined) {
    if (inputs.egressGB < 0) {
      throw new Error("egressGB must be non-negative");
    }
    return inputs.egressGB;
  }
  if (
    inputs.auditStreamIngressGBPerMonth !== undefined &&
    inputs.auditStreamIngressGBPerMonth >= 0
  ) {
    return inputs.auditStreamIngressGBPerMonth;
  }
  throw new Error(
    "egress requires egressGB or auditStreamIngressGBPerMonth (fail closed — no invented volume)",
  );
}
