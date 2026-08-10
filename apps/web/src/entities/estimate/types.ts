/**
 * Estimate entity types — shaped from generated OpenAPI schemas only.
 * Widgets must display these; they must not compute line amounts.
 */
import type { components } from "../../shared/api/generated/openapi.types.ts";

export type EstimateResponse = components["schemas"]["EstimateResponse"];
export type LineItem = components["schemas"]["LineItem"];
export type CreateEstimateRequest =
  components["schemas"]["CreateEstimateRequest"];
export type EstimateCapabilities =
  components["schemas"]["EstimateCapabilities"];
