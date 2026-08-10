/**
 * RatesAdapter port — fetch/normalize provider retail price APIs.
 * Implementations live under providers/{azure,aws,gcp}; core stays fetch-agnostic at the type level.
 */
import type { CloudProvider, RateCard, RatesSource } from "../models/estimate.types.ts";

export interface RatesAdapter {
  readonly provider: CloudProvider;
  /**
   * Resolve a RateCard for region, preferring live → cache → fallback per rates module rules.
   * @returns RateCard plus metadata; must not invent $0 for unknown meters.
   * @remarks Optional `warnings` carry EDGE signals (unknown region, stale fallback, non-USD skipped).
   */
  getRates(region: string): Promise<{
    rates: RateCard;
    ratesSource: RatesSource;
    ageDays: number;
    warnings?: string[];
  }>;
}
