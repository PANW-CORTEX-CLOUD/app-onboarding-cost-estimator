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
import { logger } from "hono/logger";
import { swaggerUI } from "@hono/swagger-ui";
import {
  modelVersion,
  projectCosts,
  getRates,
  createEstimate,
  freezeEstimate,
  loadFrozenEstimate,
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
  FreezeEstimateRequestSchema,
  RefreshRatesRequestSchema,
  ReloadFrozenEstimateRequestSchema,
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

  // Request access log (method/path/status/latency) - the only observability
  // this API had was a one-time startup banner and a fatal-error console.error;
  // there was no per-request trace at all. hono/logger is already a transitive
  // dependency of hono itself (zero new package). Skipped under vitest so
  // `pnpm test` output stays readable - createApp() is called fresh in nearly
  // every API test.
  if (!process.env.VITEST) {
    app.use("*", logger());
  }

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

  /**
   * Freeze an estimate: re-run it server-side and pin the exact rate card it
   * priced with, so the same payload reproduces the same total later even
   * after live rates move.
   */
  app.post("/v1/estimates/freeze", async (c) => {
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
    const parsed = FreezeEstimateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return problemJson(
        c,
        problem(400, "Validation failed", parsed.error.message),
        400,
      );
    }
    const { ackCriticalStale, ...estimateRequest } = parsed.data;
    try {
      const estimate = await createEstimate(estimateRequest);
      // freezeEstimate throws when rates are critically stale without an ack -
      // that is the fail-closed export gate, so it must surface as a 400 the
      // caller can act on, not be swallowed into an unpinned success.
      const frozen = freezeEstimate({
        result: {
          provider: estimate.provider,
          lineItems: estimate.lineItems,
          totals: estimate.totals,
          confidence: estimate.confidence,
        },
        rateCard: estimate.rateCard,
        inputs: {
          provider: estimateRequest.provider,
          region: estimateRequest.region,
          capabilities: estimateRequest.capabilities,
          ...(estimateRequest.volume
            ? { volume: estimateRequest.volume }
            : {}),
        },
        ratesSource: estimate.ratesSource,
        ...(ackCriticalStale !== undefined ? { ackCriticalStale } : {}),
      });
      return c.json(frozen);
    } catch (e) {
      return problemJson(
        c,
        problem(
          400,
          "Freeze failed",
          e instanceof Error ? e.message : "unknown error",
        ),
        400,
      );
    }
  });

  /**
   * Reload a frozen estimate. A corrupt payload, a wrong schema version, or a
   * modelVersion the engine has moved past all fail closed with a named
   * reason rather than silently re-pricing at today's rates.
   */
  app.post("/v1/estimates/reload", async (c) => {
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
    const parsed = ReloadFrozenEstimateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return problemJson(
        c,
        problem(400, "Validation failed", parsed.error.message),
        400,
      );
    }
    const loaded = loadFrozenEstimate(parsed.data.payload, {
      ...(parsed.data.requireCurrentModelVersion !== undefined
        ? { requireCurrentModelVersion: parsed.data.requireCurrentModelVersion }
        : {}),
    });
    if (!loaded.ok) {
      // The failure code (corrupt | invalid_schema | model_version_mismatch)
      // rides in the title so a client can tell "this file is damaged" from
      // "this quote predates the current pricing model" without parsing prose.
      return problemJson(
        c,
        problem(400, `Reload failed: ${loaded.code}`, loaded.error),
        400,
      );
    }
    return c.json({ payload: loaded.payload, warnings: loaded.warnings });
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
