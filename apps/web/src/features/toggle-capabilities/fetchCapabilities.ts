/**
 * Feature: toggle capabilities — GET /v1/capabilities for selected provider.
 */
import type { CostApiClient } from "../../shared/api/client.ts";
import type { CloudProvider } from "../../entities/provider/model.ts";
import type { CapabilitiesResponse } from "../../entities/rates/types.ts";

export class CapabilitiesApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CapabilitiesApiError";
    this.status = status;
  }
}

export async function fetchCapabilities(
  client: CostApiClient,
  provider: CloudProvider,
): Promise<CapabilitiesResponse> {
  const { data, error, response } = await client.GET("/capabilities", {
    params: { query: { provider } },
  });
  if (error || !data) {
    throw new CapabilitiesApiError(
      "Capabilities request failed",
      response?.status ?? 0,
    );
  }
  return data;
}
