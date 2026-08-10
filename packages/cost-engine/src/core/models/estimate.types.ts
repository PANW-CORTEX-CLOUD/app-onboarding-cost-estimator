/**
 * Shared estimate DTOs for the generic core.
 * Provider-specific meter IDs and formulas must not appear here — only union provider tags.
 */

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
  /** meterId → unit price */
  unitPrices: Record<string, number>;
  capturedAt: string;
}

export interface LineItem {
  provider: CloudProvider;
  capability: string;
  meterId: string;
  amount: number;
  confidence: Confidence;
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
