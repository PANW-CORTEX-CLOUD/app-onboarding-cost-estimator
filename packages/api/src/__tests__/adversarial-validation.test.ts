/**
 * REQ-24 — adversarial request-validation hardening, from the bug-hunt sweep.
 *
 * Three defects were found by probing the live API with hostile payloads:
 *  1. `__proto__` as a body key passed validation (200) while a plain unknown
 *     key was rejected (400) — Zod `.strict()` silently drops `__proto__` before
 *     the strict check sees it, so the "unknown keys fail closed" contract had a
 *     hole. No pollution occurred, but the boundary must reject what it claims.
 *  2. A 100k-char `region` was accepted — the string had no upper bound.
 *  3. `capabilities:{}` returned `expected:0, confidence:High, warnings:[]` — an
 *     authoritative-looking $0 with nothing said about it.
 *
 * The problem+json media type is asserted alongside status so a regression to a
 * bare `application/json` error (the REQ bug two sessions independently hit)
 * would fail here too.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

/** A minimal, valid audit-only estimate payload (override pins stream metrics). */
function validEstimatePayload(): string {
  return JSON.stringify({
    provider: "azure",
    region: "eastus",
    capabilities: { auditLogs: true },
    volume: {
      accountCount: 10,
      ingressGBPerDay: 5,
      overrideStreamMetrics: true,
      peakMBps: 1,
      peakEventsPerSec: 10,
    },
  });
}

describe("REQ-24 — prototype-pollution keys fail closed", () => {
  it("rejects a `__proto__` key in a nested object with a 400 problem+json", async () => {
    const app = createApp();
    // Hand-built JSON: `JSON.stringify({__proto__: …})` would set the prototype
    // rather than emit a literal `__proto__` key, so the attack must be a raw
    // string to reach the parser as an own property.
    const hostile =
      '{"provider":"azure","region":"eastus","capabilities":{"auditLogs":true},' +
      '"volume":{"accountCount":10,"ingressGBPerDay":5,"overrideStreamMetrics":true,' +
      '"peakMBps":1,"peakEventsPerSec":10,"__proto__":{"polluted":true}}}';
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: JSON_HEADERS,
      body: hostile,
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    const body = await res.json();
    expect(body.detail).toMatch(/__proto__|disallowed key/i);
    // The probe must not have poisoned the running process.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects a top-level `constructor` key", async () => {
    const app = createApp();
    const hostile =
      '{"provider":"azure","region":"eastus","constructor":{"x":1},' +
      '"capabilities":{"auditLogs":true},"volume":{"accountCount":10,' +
      '"ingressGBPerDay":5,"overrideStreamMetrics":true,"peakMBps":1,"peakEventsPerSec":10}}';
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: JSON_HEADERS,
      body: hostile,
    });
    expect(res.status).toBe(400);
  });

  it("the same guard covers the projections route", async () => {
    const app = createApp();
    const res = await app.request("/v1/projections", {
      method: "POST",
      headers: JSON_HEADERS,
      body: '{"monthlyExpected":100,"months":12,"__proto__":{"x":1}}',
    });
    expect(res.status).toBe(400);
  });

  it("a legitimate payload still succeeds (no false positive)", async () => {
    const app = createApp();
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: JSON_HEADERS,
      body: validEstimatePayload(),
    });
    expect(res.status).toBe(200);
  });
});

describe("REQ-24 — region length is bounded", () => {
  it("rejects a region far longer than any real slug", async () => {
    const app = createApp();
    const payload = JSON.parse(validEstimatePayload());
    payload.region = "x".repeat(100_000);
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
  });

  it("still accepts the longest real region names", async () => {
    const app = createApp();
    const payload = JSON.parse(validEstimatePayload());
    payload.provider = "gcp";
    payload.region = "northamerica-northeast2";
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
  });
});

describe("REQ-24 — projections are bounded and never emit a non-finite cost", () => {
  function projection(body: Record<string, unknown>): string {
    return JSON.stringify({ monthlyExpected: 100, months: 12, ...body });
  }
  function postProjection(app: ReturnType<typeof createApp>, body: string) {
    return app.request("/v1/projections", {
      method: "POST",
      headers: JSON_HEADERS,
      body,
    });
  }
  function lineItems(n: number, amount = 1) {
    return Array.from({ length: n }, () => ({
      provider: "azure",
      capability: "auditLogs",
      meterId: "m",
      amount,
      confidence: "High",
    }));
  }

  it("rejects a line-items array over the cap (amplification vector)", async () => {
    const app = createApp();
    const res = await postProjection(
      app,
      projection({ lineItems: lineItems(201) }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
  });

  it("accepts a legal-sized line-items array", async () => {
    const app = createApp();
    const res = await postProjection(
      app,
      projection({ lineItems: lineItems(50) }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a negative line-item amount", async () => {
    const app = createApp();
    const res = await postProjection(
      app,
      projection({ lineItems: lineItems(1, -999) }),
    );
    expect(res.status).toBe(400);
  });

  it("fails closed on numeric overflow instead of returning null cost fields", async () => {
    const app = createApp();
    const res = await postProjection(
      app,
      JSON.stringify({
        monthlyExpected: 1e308,
        months: 36,
        annualGrowthPercent: 1e300,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toMatch(/overflow|not finite/i);
  });
});

describe("REQ-24 — an empty selection is not a silent $0", () => {
  it("prices nothing but warns instead of presenting an authoritative $0", async () => {
    const app = createApp();
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: JSON_HEADERS,
      body: '{"provider":"azure","region":"eastus","capabilities":{},"volume":{"accountCount":10}}',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.expected).toBe(0);
    expect(body.lineItems).toHaveLength(0);
    expect(body.warnings.join(" ")).toMatch(/no billable capability/i);
  });
});
