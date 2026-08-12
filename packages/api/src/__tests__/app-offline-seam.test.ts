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

describe("REQ-15/REQ-20 EDGE — a rate-source failure surfaces as a 502 problem+json, not a hang or a 400", () => {
  /** An adapter whose live/fallback path both fail — models a rate-feed outage. */
  const explodingAdapter: RatesAdapter = {
    provider: "azure",
    async getRates() {
      throw new Error("simulated rate-feed outage");
    },
  };
  /** An adapter that "succeeds" but returns a corrupt (non-finite) unit price. */
  const corruptPriceAdapter: RatesAdapter = {
    provider: "azure",
    async getRates(region: string) {
      return {
        rates: {
          provider: "azure" as const,
          region,
          currency: "USD" as const,
          unitPrices: { "eh-standard-tu": Number.POSITIVE_INFINITY },
          capturedAt: NOW.toISOString(),
        },
        ratesSource: "live" as const,
        ageDays: 0,
        warnings: [],
      };
    },
  };

  it("GET /v1/rates with a throwing adapter → 502 problem+json (upstream, not internal), no raw error leaked", async () => {
    const app = createApp({
      ratesOptions: { adapters: { azure: explodingAdapter }, cache: createRatesCache() },
    });
    const res = await app.request("/v1/rates?provider=azure&region=eastus");
    // getRates wraps the adapter throw as UpstreamRateError; the onError net
    // renders it as a 502 — an honest "the pricing feed failed", not a 500 that
    // calls it an internal bug, and not a hang.
    expect(res.status).toBe(502);
    expect(res.headers.get("Content-Type")).toMatch(/application\/problem\+json/);
    const body = await res.json();
    expect(body.status).toBe(502);
    // The raw internal error message must NOT reach the client (CWE-209).
    expect(body.detail).not.toMatch(/simulated rate-feed outage/);
    expect(body.detail).toMatch(/not a problem with your request/i);
    expect(body.instance).toBeTruthy();
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    expect(body.instance).toBe(res.headers.get("X-Request-Id"));
  });

  it("POST /v1/estimates with a corrupt-price adapter → 502, not a 400 that blames the request", async () => {
    const app = createApp({
      ratesOptions: { adapters: { azure: corruptPriceAdapter }, cache: createRatesCache() },
    });
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        capabilities: { auditLogs: true },
        volume: { accountCount: 10, ingressGBPerDay: 10, peakMBps: 1, peakEventsPerSec: 1000 },
      }),
    });
    // A corrupt price is upstream/server data, never the caller's input — the
    // estimates catch must return 502, not the old catch-all 400.
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe(502);
    expect(body.detail).not.toMatch(/eh-standard-tu/); // no raw meter detail leaked
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("POST /v1/estimates with a genuine validation refusal is still a 400 (client-actionable)", async () => {
    const app = createApp({ ratesOptions: offline() });
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ADS enabled but its required sizing drivers omitted → engine refuses.
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        capabilities: { adsCloud: true },
        volume: {},
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.status).toBe(400);
    // A 4xx names the domain reason the caller can act on.
    expect(body.detail).toBeTruthy();
  });
});

describe("REQ-19 — registry cross-region pull over HTTP", () => {
  it("POST /v1/estimates with crossRegionPull bills the registry line and reports the avgImageGB assumption", async () => {
    const app = createApp({ ratesOptions: offline() });
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        capabilities: { registry: true },
        // avgImageGB omitted on purpose: the engine must default it (and report
        // the assumption) rather than collapse the cross-region line to $0.
        volume: { imageCount: 100, scansPerMonth: 1, crossRegionPull: true },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const reg = body.lineItems.find(
      (li: { capability: string }) => li.capability === "registry",
    );
    expect(reg).toBeDefined();
    expect(reg.amount).toBeGreaterThan(0);
    const applied = body.appliedDefaults?.find(
      (d: { field: string }) => d.field === "volume.avgImageGB",
    );
    expect(applied?.kind).toBe("assumption");
  });

  it("same request without crossRegionPull leaves the registry line at $0", async () => {
    const app = createApp({ ratesOptions: offline() });
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "azure",
        region: "eastus",
        capabilities: { registry: true },
        volume: { imageCount: 100, avgImageGB: 2, scansPerMonth: 1 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const reg = body.lineItems.find(
      (li: { capability: string }) => li.capability === "registry",
    );
    expect(reg.amount).toBe(0);
  });
});
