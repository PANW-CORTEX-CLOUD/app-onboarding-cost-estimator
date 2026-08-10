/**
 * Feature: run-estimate — POST /v1/estimates via openapi-fetch only.
 * No formulas; fails closed on API error (caller shows retry / cache).
 */
import type { CostApiClient } from "../../shared/api/client.ts";
import type {
  CreateEstimateRequest,
  EstimateResponse,
} from "../../entities/estimate/types.ts";

export class EstimateApiError extends Error {
  readonly status: number;
  readonly problem: unknown;

  constructor(message: string, status: number, problem: unknown) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.problem = problem;
  }
}

export async function runEstimate(
  client: CostApiClient,
  body: CreateEstimateRequest,
): Promise<EstimateResponse> {
  const { data, error, response } = await client.POST("/estimates", { body });
  if (error || !data) {
    const detail = problemDetail(error);
    throw new EstimateApiError(
      detail
        ? `Estimate request failed: ${detail}`
        : "Estimate request failed",
      response?.status ?? 0,
      error ?? null,
    );
  }
  return data;
}

function problemDetail(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { detail?: unknown; message?: unknown; error?: unknown };
  if (typeof e.detail === "string" && e.detail.trim()) return e.detail;
  if (typeof e.message === "string" && e.message.trim()) return e.message;
  if (typeof e.error === "string" && e.error.trim()) return e.error;
  return null;
}
