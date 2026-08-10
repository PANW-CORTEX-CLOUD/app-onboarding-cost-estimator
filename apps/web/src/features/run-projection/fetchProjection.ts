/**
 * Feature: fetch projection via OpenAPI createProjection (no UI pricing).
 */
import type { CostApiClient } from "../../shared/api/client.ts";
import type { components } from "../../shared/api/generated/openapi.types.ts";

export type CreateProjectionRequest =
  components["schemas"]["CreateProjectionRequest"];
export type ProjectionResponse = components["schemas"]["ProjectionResponse"];

export class ProjectionApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProjectionApiError";
    this.status = status;
  }
}

export async function fetchProjection(
  client: CostApiClient,
  body: CreateProjectionRequest,
): Promise<ProjectionResponse> {
  const { data, error, response } = await client.POST("/projections", { body });
  if (error || !data) {
    throw new ProjectionApiError(
      "Projection request failed",
      response?.status ?? 0,
    );
  }
  return data;
}
