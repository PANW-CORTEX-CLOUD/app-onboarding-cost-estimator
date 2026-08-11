/**
 * REQ-15 T-15.2.1 — the pricing routes must be drivable without the network.
 *
 * `createApp({ ratesOptions })` threads the engine's own rate-resolution seam
 * (adapters / cache / forceLive / now) into `/v1/rates`, `/v1/rates/refresh`,
 * `/v1/estimates` and `/v1/estimates/freeze`. With `forceFallback` adapters the
 * HTTP layer prices from the in-repo fallback file, so these assertions are
 * deterministic and touch no live feed. The companion edge case proves the
 * global `onError` net turns an adapter that throws into a 5xx problem+json
 * response rather than a hung request or a bare 500.
 */
import { describe, expect, it } from "vitest";
import {
  createAzureRatesAdapter,
  createAwsRatesAdapter,
  createGcpRatesAdapter,
  createRatesCache,
  createEstimate,
  type RatesAdapter,
} from "@cloud-connector/cost-engine";
import { createApp } from "../app.ts";

/** Pin the clock so `ageDays`/freshness are deterministic across the suite. */
const NOW = new Date("2026-08-11T00:00:00.000Z");

/**
 * Offline seam: every provider serves its crawler-verified fallback file.
 *
 * A **fresh** cache per call, on purpose: a shared cache would make the first
 * test that resolves a region cache it, so a later test would see
 * `ratesSource: "cache"` instead of `"fallback"` — still offline, but the
 * source would depend on test execution order. A per-test cache keeps each
 * assertion's first resolution deterministic.
 */
function offline() {
  return {
    adapters: {
      azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
      aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
      gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
    },
    cache: createRatesCache(),
    now: NOW,
  };
}

describe("REQ-15 — pricing routes drivable offline via injected rates seam", () => {
  it("GET /v1/rates serves fallback rates with no network", async () => {
    const app = createApp({ ratesOptions: offline() });
    const res = await app.request("/v1/rates?provider=azure&region=eastus");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("azure");
    expect(body.ratesSource).toBe("fallback");
    expect(Object.keys(body.unitPrices).length).toBeGreaterThan(0);
  });

  it("POST /v1/estimates prices from the injected fallback and matches the engine", async () => {
    const app = createApp({ ratesOptions: offline() });
    const payload = {
      provider: "azure" as const,
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
    expect(body.ratesSource).toBe("fallback");
    // Same seam through the engine directly → the HTTP total is deterministic.
    const engine = await createEstimate({ ...payload, ratesOptions: offline(), now: NOW });
    expect(body.totals.expected).toBeCloseTo(engine.totals.expected, 6);
  });

  it("EDGE: the same estimate is identical across two calls (no clock/network drift)", async () => {
    const app = createApp({ ratesOptions: offline() });
    const payload = {
      provider: "aws",
      region: "us-east-1",
      capabilities: { auditLogs: true },
      volume: { accountCount: 5, ingressGBPerDay: 1, peakMBps: 0.25, peakEventsPerSec: 250 },
    };
    const call = async () => {
      const r = await app.request("/v1/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return r.json();
    };
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.totals.expected).toBe(b.totals.expected);
    expect(a.ratesAsOf).toBe(b.ratesAsOf);
  });

  it("POST /v1/estimates/freeze pins the injected fallback card deterministically", async () => {
    const app = createApp({ ratesOptions: offline() });
    const res = await app.request("/v1/estimates/freeze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        capabilities: { auditLogs: true },
        volume: { accountCount: 10, ingressGBPerDay: 10, peakMBps: 1, peakEventsPerSec: 1000 },
      }),
    });
    expect(res.status).toBe(200);
    const frozen = await res.json();
    // The frozen export pins the card it priced with. Assert the fields that
    // prove it froze from the injected offline card: the fallback file's
    // capturedAt date and a stable input hash, both network-independent.
    expect(frozen.provider).toBe("azure");
    expect(frozen.schemaVersion).toBeTruthy();
    expect(frozen.inputHash).toBeTruthy();
    expect(frozen.rateCard.capturedAt).toBe(frozen.ratesAsOf);
    expect(Object.keys(frozen.rateCard.unitPrices).length).toBeGreaterThan(0);
  });
});

describe("REQ-15 EDGE — an adapter that throws surfaces as a 5xx problem+json, not a hang", () => {
  /** An adapter whose live/fallback path both fail — models a rate-feed outage. */
  const explodingAdapter: RatesAdapter = {
    provider: "azure",
    async getRates() {
      throw new Error("simulated rate-feed outage");
    },
  };

  it("GET /v1/rates with a throwing adapter → 500 problem+json, no raw error leaked", async () => {
    const app = createApp({
      ratesOptions: { adapters: { azure: explodingAdapter }, cache: createRatesCache() },
    });
    const res = await app.request("/v1/rates?provider=azure&region=eastus");
    // The route has no local try/catch; the global onError net catches the
    // throw and renders it, so the client gets a parseable response, not a hang.
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toMatch(/application\/problem\+json/);
    const body = await res.json();
    expect(body.status).toBe(500);
    // The raw internal error message must NOT reach the client (CWE-209): an
    // unexpected throw can carry upstream/internal detail. The detail is a
    // stable, generic string; the real cause is in the server logs, correlated
    // by the request id echoed in `instance` and the X-Request-Id header.
    expect(body.detail).not.toMatch(/simulated rate-feed outage/);
    expect(body.detail).toMatch(/unexpected internal error/i);
    expect(body.instance).toBeTruthy();
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(body.instance).toBe(res.headers.get("X-Request-Id"));
  });
});
