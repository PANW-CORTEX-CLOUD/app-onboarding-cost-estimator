/**
 * Rates / freshness entity types from OpenAPI — display only in UI.
 */
import type { components } from "../../shared/api/generated/openapi.types.ts";

export type RatesResponse = components["schemas"]["RatesResponse"];
export type CapabilitiesResponse =
  components["schemas"]["CapabilitiesResponse"];
export type CapabilityMeterRow = components["schemas"]["CapabilityMeterRow"];

export type FreshnessLevel = "fresh" | "warn" | "critical" | "stale-cache";
