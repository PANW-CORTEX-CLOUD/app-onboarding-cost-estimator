/**
 * Shared estimate DTOs for the generic core.
 * Provider-specific meter IDs and formulas must not appear here — only union provider tags.
 */

import type { PriceTier } from "../graduated-pricing.ts";

export type CloudProvider = "azure" | "aws" | "gcp";

export type RatesSource = "live" | "cache" | "fallback";

export type Confidence = "High" | "Med" | "Low";

/** Provider-agnostic estimate inputs (volume signals + capability toggles). */
export interface EstimateInputs {
  provider: CloudProvider;
  region: string;
  /**
   * Resolved month hours for hourly / proration math.
   * Prefer `monthHoursConvention` + resolveMonthHours(); locked default is 730.
   */
  monthHours?: number;
  /** Convention selector — see core/hours.ts (730 | 744 | actual). */
  monthHoursConvention?: "730" | "744" | "actual";
  /**
   * Peak throughput multiplier (>=1). Scales capacity recommendation only —
   * does not multiply average event volume (package 05).
   */
  peakFactor?: number;
  capabilities: {
    discovery?: boolean;
    auditLogs?: boolean;
    adsCloud?: boolean;
    adsOutpost?: boolean;
    dspm?: boolean;
    registry?: boolean;
    serverless?: boolean;
  };
  /** Opaque volume bag — detailed in package 12. */
  volume?: Record<string, number | string | boolean>;
}

export interface RateCard {
  provider: CloudProvider;
  region: string;
  currency: "USD";
  /**
   * meterId → unit price.
   *
   * For a meter with a published price ladder this is the **first band's**
   * rate, which is what "the rate" means for anything that is not modelling
   * tiers. `unitTiers` carries the full ladder when one exists.
   */
  unitPrices: Record<string, number>;
  /**
   * meterId → published price ladder, when the vendor graduates the price.
   * Absent for flat-rate meters. See core/graduated-pricing.ts.
   */
  unitTiers?: Record<string, PriceTier[]>;
  capturedAt: string;
}

/**
 * Provenance for the rate behind one line item: whether the number was last
 * seen in the vendor's own price list, and how long ago. Provider-agnostic on
 * purpose — the ledger that produces it lives under providers/.
 */
export interface LineItemVerification {
  verdict: "verified" | "mismatch" | "unsupported-meter" | "proxy" | "unverified";
  /** ISO date of the last comparison against the official source; null = never. */
  verifiedAt: string | null;
  ageDays: number;
  /** Past its re-check window. */
  stale: boolean;
  /** Safe to present as a vendor-published price. */
  trusted: boolean;
  sourceUrl: string;
}

export interface LineItem {
  provider: CloudProvider;
  capability: string;
  meterId: string;
  amount: number;
  confidence: Confidence;
  /** Rate provenance (createEstimate attaches this; sub-estimators do not). */
  verification?: LineItemVerification;
}

export interface EstimateResult {
  provider: CloudProvider;
  lineItems: LineItem[];
  totals: { expected: number; low?: number; high?: number };
  confidence: Confidence;
  modelVersion?: string;
  ratesAsOf?: string;
  /** Deterministic hash of EstimateInputs (package 13). */
  inputHash?: string;
}
