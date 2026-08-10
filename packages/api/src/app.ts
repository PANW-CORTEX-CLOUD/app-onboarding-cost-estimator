/**
 * Hono app factory — OpenAPI-validated REST over cost-engine (package 15).
 * No pricing formulas here; maps DTOs ↔ engine ports only.
 * Never returns raw provider OData / price-list payloads.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Context } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import {
  modelVersion,
  projectCosts,
  getRates,
  createEstimate,
  azureCapabilityMeterMap,
  awsCapabilityMeterMap,
  gcpCapabilityMeterMap,
} from "@cloud-connector/cost-engine";
import { problem, type ProblemDetails } from "./problem.ts";
import { refreshRatesLimiter } from "./rate-limit.ts";
import {
  CloudProviderSchema,
  CreateEstimateRequestSchema,
  CreateProjectionRequestSchema,
  RefreshRatesRequestSchema,
} from "./schemas.ts";

export const API_VERSION = "0.2.0";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadOpenApiYaml(): string {
  const candidates = [
    path.resolve(__dirname, "../../../openapi/openapi.yaml"),
    path.resolve(process.cwd(), "openapi/openapi.yaml"),
    path.resolve(process.cwd(), "../../openapi/openapi.yaml"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("openapi/openapi.yaml not found (fail closed)");
}

function problemJson(c: Context, body: ProblemDetails, status: 400 | 429) {
  c.header("Content-Type", "application/problem+json");
  return c.json(body, status);
}

function sanitizeRatesResponse(
  provider: "azure" | "aws" | "gcp",
  region: string,
  result: Awaited<ReturnType<typeof getRates>>,
) {
  // EDGE: never expose raw provider OData / price-list payloads
  return {
    provider,
    region: result.rates.region || region,
    currency: "USD" as const,
    unitPrices: { ...result.rates.unitPrices },
    ratesAsOf: result.rates.capturedAt,
    ratesSource: result.ratesSource,
    ageDays: Number.isFinite(result.ageDays) ? result.ageDays : 9999,
    modelVersion,
    warnings: result.warnings,
    freshness: result.freshness
      ? {
          level: result.freshness.level,
          banner: result.freshness.banner,
          requiresAckBeforeExport: result.freshness.requiresAckBeforeExport,
        }
      : undefined,
  };
}

function meterMapFor(provider: "azure" | "aws" | "gcp") {
  const map =
    provider === "azure"
      ? azureCapabilityMeterMap
      : provider === "aws"
        ? awsCapabilityMeterMap
        : gcpCapabilityMeterMap;
  return map.map((r) => ({
    capability: r.capability,
    meterId: r.meterId,
    meterSku: r.meterSku,
    confidence: r.confidence,
    sourceUrl: r.sourceUrl,
  }));
}

export function createApp(): Hono {
  const app = new Hono();

  app.get("/v1/health", (c) =>
    c.json({
      status: "ok" as const,
      modelVersion,
      service: "cloud-connector-api",
      apiVersion: API_VERSION,
    }),
  );

  app.get("/v1/openapi.yaml", (c) => {
    const yaml = loadOpenApiYaml();
    return c.body(yaml, 200, { "Content-Type": "application/yaml" });
  });

  app.get("/v1/docs", swaggerUI({ url: "/v1/openapi.yaml" }));

  app.get("/v1/capabilities", (c) => {
    const parsed = CloudProviderSchema.safeParse(c.req.query("provider"));
    if (!parsed.success) {
      return problemJson(
        c,
        problem(400, "Invalid provider", "provider must be azure|aws|gcp"),
        400,
      );
    }
    return c.json({
      provider: parsed.data,
      capabilities: meterMapFor(parsed.data),
    });
  });

  app.get("/v1/rates", async (c) => {
    const providerParsed = CloudProviderSchema.safeParse(c.req.query("provider"));
    const region = c.req.query("region");
    if (!providerParsed.success || !region) {
      return problemJson(
        c,
        problem(
          400,
          "Invalid query",
          "provider (azure|aws|gcp) and region are required",
        ),
        400,
      );
    }
    const result = await getRates(providerParsed.data, region);
    return c.json(sanitizeRatesResponse(providerParsed.data, region, result));
  });

  app.post("/v1/rates/refresh", async (c) => {
    const limit = refreshRatesLimiter.check("global");
    if (!limit.ok) {
      c.header("Retry-After", String(limit.retryAfterSec));
      return problemJson(
        c,
        problem(
          429,
          "Rate limit exceeded",
          `refreshRates limited; retry after ${limit.retryAfterSec}s`,
        ),
        429,
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problemJson(
        c,
        problem(400, "Invalid JSON", "request body must be JSON"),
        400,
      );
    }
    const parsed = RefreshRatesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return problemJson(
        c,
        problem(400, "Validation failed", parsed.error.message),
        400,
      );
    }
    const result = await getRates(parsed.data.provider, parsed.data.region, {
      forceLive: parsed.data.forceLive !== false,
    });
    return c.json(
      sanitizeRatesResponse(parsed.data.provider, parsed.data.region, result),
    );
  });

  app.post("/v1/estimates", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problemJson(
        c,
        problem(400, "Invalid JSON", "request body must be JSON"),
        400,
      );
    }
    const parsed = CreateEstimateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return problemJson(
        c,
        problem(400, "Validation failed", parsed.error.message),
        400,
      );
    }
    try {
      const estimate = await createEstimate(parsed.data);
      return c.json({
        provider: estimate.provider,
        lineItems: estimate.lineItems,
        totals: estimate.totals,
        confidence: estimate.confidence,
        modelVersion: estimate.modelVersion,
        ratesAsOf: estimate.ratesAsOf,
        inputHash: estimate.inputHash,
        ratesSource: estimate.ratesSource,
        warnings: estimate.warnings,
        tfMode: estimate.tfMode,
        excludedCapabilities: estimate.excludedCapabilities,
        resolvedVolume: estimate.resolvedVolume,
      });
    } catch (e) {
      return problemJson(
        c,
        problem(
          400,
          "Estimate failed",
          e instanceof Error ? e.message : "unknown error",
        ),
        400,
      );
    }
  });

  app.post("/v1/projections", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problemJson(
        c,
        problem(400, "Invalid JSON", "request body must be JSON"),
        400,
      );
    }
    const parsed = CreateProjectionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return problemJson(
        c,
        problem(400, "Validation failed", parsed.error.message),
        400,
      );
    }
    try {
      const projected = projectCosts({
        monthlyExpected: parsed.data.monthlyExpected,
        months: parsed.data.months,
        annualGrowthPercent: parsed.data.annualGrowthPercent,
        provider: parsed.data.provider,
        monthlyLow: parsed.data.monthlyLow,
        monthlyHigh: parsed.data.monthlyHigh,
        lineItems: parsed.data.lineItems,
      });
      return c.json({
        ...projected,
        modelVersion,
        provider: parsed.data.provider,
      });
    } catch (e) {
      return problemJson(
        c,
        problem(
          400,
          "Projection failed",
          e instanceof Error ? e.message : "unknown error",
        ),
        400,
      );
    }
  });

  return app;
}

export const app = createApp();
export default app;
