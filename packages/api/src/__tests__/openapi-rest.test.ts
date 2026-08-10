/**
 * Package 15 — OpenAPI REST contract + engine parity tests.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createEstimate, projectCosts } from "@cloud-connector/cost-engine";
import { createApp } from "../app.ts";
import { refreshRatesLimiter } from "../rate-limit.ts";
import { CreateEstimateRequestSchema } from "../schemas.ts";

describe("package 15 — OpenAPI REST", () => {
  beforeEach(() => {
    refreshRatesLimiter.reset();
  });

  it("getHealth returns modelVersion + apiVersion", async () => {
    const app = createApp();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.apiVersion).toBe("0.2.0");
    expect(body.service).toBe("cloud-connector-api");
  });

  it("GET /v1/rates returns sanitized card (no raw OData keys)", async () => {
    const app = createApp();
    const res = await app.request("/v1/rates?provider=azure&region=eastus");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("azure");
    expect(body.currency).toBe("USD");
    expect(body.unitPrices).toBeTypeOf("object");
    expect(body.ratesAsOf).toBeTruthy();
    expect(body.ratesSource).toMatch(/live|cache|fallback/);
    expect(body).not.toHaveProperty("Items");
    expect(body).not.toHaveProperty("odata");
    expect(body).not.toHaveProperty("PriceList");
    expect(JSON.stringify(body)).not.toMatch(/@odata/i);
  });

  it("POST /v1/estimates returns lineItems+totals+confidence+provider+ratesAsOf+modelVersion", async () => {
    const app = createApp();
    const payload = {
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: {
        accountCount: 10,
        ingressGBPerDay: 10,
        peakMBps: 1,
        peakEventsPerSec: 1000,
      },
    };
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("azure");
    expect(Array.isArray(body.lineItems)).toBe(true);
    expect(body.totals.expected).toBeTypeOf("number");
    expect(body.confidence).toMatch(/High|Med|Low/);
    expect(body.modelVersion).toBeTruthy();
    expect(body.ratesAsOf).toBeTruthy();
    expect(body.inputHash).toBeTruthy();

    const engine = await createEstimate(payload as never);
    expect(Math.abs(body.totals.expected - engine.totals.expected)).toBeLessThanOrEqual(
      0.01,
    );
  });

  it("POST /v1/projections 0% growth is flat = monthly estimate", async () => {
    const app = createApp();
    const res = await app.request("/v1/projections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monthlyExpected: 42,
        months: 3,
        annualGrowthPercent: 0,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.series).toHaveLength(3);
    expect(body.table).toHaveLength(3);
    expect(body.series.every((p: { expected: number }) => p.expected === 42)).toBe(
      true,
    );
    expect(body.series[2].cumulative).toBe(126);
    expect(body.disclaimer).toMatch(/does not imply reserved/i);
    const core = projectCosts({
      monthlyExpected: 42,
      months: 3,
      annualGrowthPercent: 0,
    });
    expect(body.total).toBe(core.total);
  });

  it("POST /v1/projections rejects horizon >36", async () => {
    const app = createApp();
    const res = await app.request("/v1/projections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyExpected: 10, months: 37 }),
    });
    expect(res.status).toBe(400);
  });

  it("engine totals match API for aws and gcp audit-only", async () => {
    const app = createApp();
    for (const provider of ["aws", "gcp"] as const) {
      const region = provider === "aws" ? "us-east-1" : "us-central1";
      const payload = {
        provider,
        region,
        capabilities: { auditLogs: true },
        volume: {
          accountCount: 10,
          ingressGBPerDay: 1,
          peakMBps: 0.25,
          peakEventsPerSec: 250,
        },
      };
      const res = await app.request("/v1/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const engine = await createEstimate(payload as never);
      expect(
        Math.abs(body.totals.expected - engine.totals.expected),
      ).toBeLessThanOrEqual(0.01);
    }
  });

  it("unknown fields fail closed (additionalProperties: false via zod .strict)", async () => {
    const bad = CreateEstimateRequestSchema.safeParse({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      inventMe: true,
    });
    expect(bad.success).toBe(false);

    const app = createApp();
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        capabilities: { auditLogs: true },
        inventMe: true,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.status).toBe(400);
    expect(body.title).toBeTruthy();
  });

  it("negative volume fields fail closed at the API boundary (400), not downstream", async () => {
    // Most volume.* numeric fields used bare z.number().optional() with no
    // .nonnegative(), unlike assumedEventBytes/avgObjectSizeMB which already
    // had .positive(). Downstream estimators happen to throw on negative
    // values too, but that's defense-in-depth, not a substitute for
    // rejecting invalid input at the boundary that receives it.
    const bad = CreateEstimateRequestSchema.safeParse({
      provider: "aws",
      region: "us-east-1",
      capabilities: { dspm: true },
      volume: { dataEstateGB: -1 },
    });
    expect(bad.success).toBe(false);

    const app = createApp();
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "aws",
        region: "us-east-1",
        capabilities: { dspm: true },
        volume: { dataEstateGB: -1 },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("refreshRates is rate-limited (429)", async () => {
    const app = createApp();
    const body = JSON.stringify({
      provider: "azure",
      region: "eastus",
      forceLive: true,
    });
    let saw429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await app.request("/v1/rates/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.status === 429) {
        saw429 = true;
        const problem = await res.json();
        expect(problem.status).toBe(429);
        break;
      }
      expect([200, 429]).toContain(res.status);
    }
    expect(saw429).toBe(true);
  });

  it("GET /v1/capabilities requires provider", async () => {
    const app = createApp();
    const bad = await app.request("/v1/capabilities");
    expect(bad.status).toBe(400);
    const ok = await app.request("/v1/capabilities?provider=aws");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.provider).toBe("aws");
    expect(body.capabilities.length).toBeGreaterThan(0);
  });

  it("POST /v1/rates/refresh forceLive bypasses cache", async () => {
    const app = createApp();
    // warm via GET
    await app.request("/v1/rates?provider=azure&region=eastus");
    const res = await app.request("/v1/rates/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        forceLive: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ratesSource).toMatch(/live|fallback/);
    expect(body.ratesAsOf).toBeTruthy();
    expect(body.ageDays).toBeTypeOf("number");
    expect(body.unitPrices).toBeTypeOf("object");
    // never raw OData
    expect(JSON.stringify(body)).not.toMatch(/@odata/i);
  });

  it("serves OpenAPI yaml for Swagger UI", async () => {
    const app = createApp();
    const res = await app.request("/v1/openapi.yaml");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/openapi:\s*3\.1\.0/);
    expect(text).toMatch(/operationId:\s*createEstimate/);
    expect(text).toMatch(/version:\s*0\.2\.0/);
  });
});
