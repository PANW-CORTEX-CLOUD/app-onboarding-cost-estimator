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
import {
  logEstimateOutcome,
  logRejection,
  requestLogger,
  requestIdOf,
} from "./request-log.ts";
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
  type GetRatesOptions,
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

/**
 * Emit an RFC 7807 error with the `application/problem+json` media type the
 * OpenAPI contract declares.
 *
 * Hono gotcha (the bug this shape fixes, found independently by two sessions):
 * `c.json()` sets its own `Content-Type: application/json` and **overwrites**
 * any value set with a prior `c.header("Content-Type", …)`. The old body did
 * exactly that, so every 400/429 across the API silently went out as
 * `application/json` — a contract violation no test caught because they only
 * checked the JSON body's `status`, never the media type. Passing the
 * content-type straight to `c.body()` keeps it on the wire. Tests now assert the
 * media type on the 400/429/500 paths.
 *
 * The status is widened to include 500/502 for the global `onError` net below,
 * which renders an unexpected throw (e.g. a rate-feed outage) as a problem+json
 * rather than Hono's default bare 500.
 */
function problemJson(
  c: Context,
  body: ProblemDetails,
  status: 400 | 429 | 500 | 502,
) {
  return c.body(JSON.stringify(body), status, {
    "Content-Type": "application/problem+json",
  });
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

/**
 * Construction-time dependencies for the API.
 *
 * The only one today is a rate-resolution seam. Every pricing route
 * (`/v1/rates`, `/v1/rates/refresh`, `/v1/estimates`, `/v1/estimates/freeze`)
 * resolves rates through `getRates`/`createEstimate`; injecting
 * `forceFallback` adapters + a fresh cache here lets the whole HTTP surface be
 * exercised without the network. Omitted in production, so rates resolve
 * live → 24h cache → in-repo fallback exactly as before.
 *
 * This is deliberately constructor injection (a `deps` arg) rather than
 * per-request `c.set()` context vars: the seam is a static test substitution,
 * not per-request state, and it mirrors the `ratesOptions` `createEstimate`
 * already accepts. `ratesOptions` is intentionally NOT read from the HTTP
 * request body — adapters and caches are not serialisable and must never be
 * caller-controlled.
 */
export type CreateAppDeps = {
  ratesOptions?: GetRatesOptions;
};

export function createApp(deps: CreateAppDeps = {}): Hono {
  const app = new Hono();
  const { ratesOptions } = deps;

  // Request access log (method/path/status/latency) - the only observability
  // this API had was a one-time startup banner and a fatal-error console.error;
  // there was no per-request trace at all. hono/logger is already a transitive
  // dependency of hono itself (zero new package). Skipped under vitest so
  // `pnpm test` output stays readable - createApp() is called fresh in nearly
  // every API test.
  if (!process.env.VITEST) {
    app.use("*", logger());
  }
  // Diagnostic log: silent unless `DEBUG=cost:api` (or `cost:*`) is set, so it
  // is safe to leave installed in tests and in production. Runs in every
  // environment precisely so a failing test can be re-run with DEBUG on.
  app.use("*", requestLogger());

  // Global error net. Hono's recommended pattern is one centralized `onError`
  // rather than a try/catch in every handler (https://hono.dev/docs/api/hono).
  // The routes below still return their own problem+json for *expected*,
  // client-actionable failures (validation, fail-closed refusals) — route-level
  // handling wins. This net exists for the *unexpected* throw: notably the
  // `/v1/rates` and `/v1/rates/refresh` routes call `getRates` without a local
  // try/catch, so a rate-adapter failure used to bubble out as Hono's default
  // bare 500 with no problem+json body. Now it surfaces as a typed 500 the
  // caller can parse — and, critically, as a response rather than a hung
  // request.
  //
  // TODO(REQ-15, error-taxonomy): a rate-feed outage is really an upstream
  // dependency failure (502/503), and `/v1/estimates`'s own catch currently
  // maps an adapter throw to 400 alongside genuine validation refusals. Giving
  // the engine typed error classes (UpstreamRateError vs ValidationError) would
  // let both this net and that catch pick the honest status instead of a
  // catch-all. Out of scope for the injection seam itself.
  app.onError((err, c) => {
    const detail = err instanceof Error ? err.message : "unknown error";
    // Log the real cause server-side, keyed to the request id.
    logRejection(c, `unhandled: ${detail}`);
    // Do NOT echo an *unexpected* error's raw message to the client (CWE-209 /
    // OWASP improper error handling). Unlike the 400 validation/fail-closed
    // paths — whose detail is domain-controlled and client-actionable — an
    // unhandled throw can carry an upstream provider's error text, an internal
    // URL, or stack-adjacent detail. That directly contradicts this file's own
    // contract ("Never returns raw provider OData / price-list payloads"). The
    // client gets a stable message plus the request id (RFC 7807 `instance`
    // and an `X-Request-Id` header) to quote to support; the real detail lives
    // in the logs under that same id.
    const requestId = requestIdOf(c);
    c.header("X-Request-Id", requestId);
    return problemJson(
      c,
      {
        ...problem(
          500,
          "Internal error",
          "An unexpected internal error occurred. Quote the request id when reporting it.",
        ),
        instance: requestId,
      },
      500,
    );
  });

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
    const result = await getRates(providerParsed.data, region, ratesOptions);
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
      // Injected adapters/cache (tests) merge in; forceLive from the request
      // always wins, since forcing a live refresh is this route's whole job.
      ...ratesOptions,
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
      logRejection(c, `schema: ${parsed.error.message}`);
      return problemJson(
        c,
        problem(400, "Validation failed", parsed.error.message),
        400,
      );
    }
    try {
      const estimate = await createEstimate(
        ratesOptions ? { ...parsed.data, ratesOptions } : parsed.data,
      );
      logEstimateOutcome(c, estimate);
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
        appliedDefaults: estimate.appliedDefaults,
        resolvedVolume: estimate.resolvedVolume,
      });
    } catch (e) {
      // Estimates fail closed by design (unsized capability, Gov region, stale
      // rates); the reason is the useful part, so it is logged, not just returned.
      const detail = e instanceof Error ? e.message : "unknown error";
      logRejection(c, `estimate: ${detail}`);
      return problemJson(c, problem(400, "Estimate failed", detail), 400);
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
      const estimate = await createEstimate(
        ratesOptions ? { ...estimateRequest, ratesOptions } : estimateRequest,
      );
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
