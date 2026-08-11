/**
 * The pricing routes must be drivable without the network (REQ-15, T-15.2.1).
 *
 * `createApp({ ratesOptions })` forwards a rate-resolution seam to every route
 * that prices anything. Injecting `forceFallback` adapters + a fresh cache
 * lets `/v1/estimates` (and the other pricing routes) be tested against the
 * in-repo fallback rates deterministically, instead of reaching the live
 * price APIs — which is what previously made API tests flaky under load.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import {
  createAzureRatesAdapter,
  createAwsRatesAdapter,
  createGcpRatesAdapter,
  createRatesCache,
  type RatesAdapter,
} from "@cloud-connector/cost-engine";

const NOW = new Date("2026-08-11T00:00:00.000Z");

/** forceFallback adapters + a private cache → no network, deterministic. */
function offlineRatesOptions() {
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

const AUDIT_BODY = {
  provider: "azure" as const,
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: {
    accountCount: 10,
    overrideStreamMetrics: true,
    ingressGBPerDay: 10,
    peakMBps: 1,
    peakEventsPerSec: 1000,
  },
};

async function postEstimate(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/v1/estimates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("pricing routes run offline via injected rates seam", () => {
  it("POST /v1/estimates prices from fallback rates, no network, deterministic", async () => {
    const app = createApp({ ratesOptions: offlineRatesOptions() });
    const res = await postEstimate(app, AUDIT_BODY);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Priced from the in-repo fallback, not whatever the live API returns today.
    expect(body.ratesSource).toBe("fallback");
    expect(body.lineItems.length).toBeGreaterThan(0);
    expect(body.totals.expected).toBeGreaterThan(0);
    expect(Number.isFinite(body.totals.expected)).toBe(true);

    // Determinism: a second app with a fresh offline seam yields the same total.
    const app2 = createApp({ ratesOptions: offlineRatesOptions() });
    const res2 = await postEstimate(app2, AUDIT_BODY);
    const body2 = await res2.json();
    expect(body2.totals.expected).toBe(body.totals.expected);
  });

  it("EDGE: an injected adapter that throws fails closed as problem+json, not a hang", async () => {
    // A rate adapter that rejects must surface as a structured error response
    // the caller can read — not an unhandled crash and not a hang. getRates
    // does not swallow adapter errors, so this propagates through
    // createEstimate to the route's fail-closed catch. The route treats every
    // estimate failure (including an upstream rate failure) as a 400 with the
    // reason attached; asserting the real status here rather than an assumed
    // 5xx.
    const throwingAzure: RatesAdapter = {
      provider: "azure",
      getRates: async () => {
        throw new Error("simulated rate-adapter outage");
      },
    };
    const app = createApp({
      ratesOptions: {
        adapters: { azure: throwingAzure },
        cache: createRatesCache(),
        now: NOW,
      },
    });
    const res = await postEstimate(app, AUDIT_BODY);
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toMatch(/application\/problem\+json/);
    const body = await res.json();
    expect(body.status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/simulated rate-adapter outage/);
  });

  it("production default (no deps) still constructs the app", () => {
    // The seam is additive: createApp() with no args behaves exactly as before
    // (live → cache → fallback). We don't exercise its network path here.
    expect(() => createApp()).not.toThrow();
  });
});
