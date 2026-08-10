/**
 * openapi-fetch client for the cost estimator API (package 15 TEST / 17 FSD).
 * Web must use this client — not deep imports into packages/api or cost-engine providers.
 */
import createClient from "openapi-fetch";
import type { paths } from "./generated/openapi.types.ts";
import { OPENAPI_SPEC_VERSION } from "./generated/openapi.types.ts";

export { OPENAPI_SPEC_VERSION, OPENAPI_SPEC_SHA256 } from "./generated/openapi.types.ts";
export type { paths as Paths } from "./generated/openapi.types.ts";

export function createCostApiClient(baseUrl = "/v1") {
  return createClient<paths>({ baseUrl });
}

export type CostApiClient = ReturnType<typeof createCostApiClient>;
