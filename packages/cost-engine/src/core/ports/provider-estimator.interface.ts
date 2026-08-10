/**
 * ProviderEstimator port — one implementation per cloud provider.
 * Formula logic stays in providers/*; UI and OpenAPI handlers only map DTOs.
 */
import type { CloudProvider, EstimateInputs, EstimateResult, RateCard } from "../models/estimate.types.ts";

export interface ProviderEstimator {
  readonly provider: CloudProvider;
  /**
   * Produce a monthly estimate from normalized inputs and a pinned/live RateCard.
   * @param inputs Capability toggles + volume signals (provider-agnostic shape).
   * @param rates Unit prices for this provider/region — never mix providers.
   * @returns Line items, totals, confidence bands; throws on invalid inputs (fail closed).
   */
  estimate(inputs: EstimateInputs, rates: RateCard): EstimateResult;
}
