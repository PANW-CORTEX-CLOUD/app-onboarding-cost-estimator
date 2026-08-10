/**
 * POST /v1/estimates/freeze and /v1/estimates/reload.
 *
 * The engine's freeze/reload cycle (core/rate-pinning.ts) was fully built and
 * unit-tested but had no HTTP route reaching it, so "freeze a quote now,
 * reproduce it later" was unreachable from the product. These cover the round
 * trip end to end plus the fail-closed paths.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../app.ts";

const baseRequest = {
  provider: "azure" as const,
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: {
    accountCount: 10,
    overrideStreamMetrics: true,
    ingressGBPerDay: 10,
    peakMBps: 1,
    peakEventsPerSec: 1000,
    avgStoredGB: 100,
  },
};

async function postJson(path: string, body: unknown) {
  const app = createApp();
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/estimates/freeze", () => {
  it("pins the rate card the estimate was actually priced with", async () => {
    const res = await postJson("/v1/estimates/freeze", baseRequest);
    expect(res.status).toBe(200);
    const frozen = await res.json();

    expect(frozen.schemaVersion).toBe(1);
    expect(frozen.provider).toBe("azure");
    expect(frozen.modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(frozen.inputHash).toMatch(/^[0-9a-f]+$/);
    expect(frozen.rateCard.provider).toBe("azure");
    expect(frozen.rateCard.currency).toBe("USD");
    expect(Object.keys(frozen.rateCard.unitPrices).length).toBeGreaterThan(0);
    expect(frozen.totals.expected).toBeGreaterThan(0);
    expect(frozen.disclaimer.length).toBeGreaterThan(20);

    // Every meter the estimate billed must carry a pinned price - a line item
    // whose rate wasn't pinned would re-price at reload time.
    for (const li of frozen.lineItems) {
      expect(frozen.rateCard.unitPrices[li.meterId]).toBeTypeOf("number");
    }
  });

  it("rejects an invalid body the same way /v1/estimates does", async () => {
    const res = await postJson("/v1/estimates/freeze", {
      ...baseRequest,
      volume: { accountCount: -1 },
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown fields (no silent drop of a misspelled ack)", async () => {
    const res = await postJson("/v1/estimates/freeze", {
      ...baseRequest,
      ackCriticalStail: true,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/estimates/reload", () => {
  it("round-trips: freeze then reload reproduces the same total exactly", async () => {
    const frozen = await (
      await postJson("/v1/estimates/freeze", baseRequest)
    ).json();

    const res = await postJson("/v1/estimates/reload", { payload: frozen });
    expect(res.status).toBe(200);
    const reloaded = await res.json();

    expect(reloaded.payload.totals.expected).toBe(frozen.totals.expected);
    expect(reloaded.payload.inputHash).toBe(frozen.inputHash);
    expect(reloaded.payload.rateCard.unitPrices).toEqual(
      frozen.rateCard.unitPrices,
    );
    expect(Array.isArray(reloaded.warnings)).toBe(true);
  });

  it("EDGE: a corrupt payload fails closed with a named code", async () => {
    const res = await postJson("/v1/estimates/reload", {
      payload: { schemaVersion: 1, provider: "azure" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toMatch(/invalid_schema/);
  });

  it("EDGE: a payload from a superseded modelVersion is refused, not re-priced", async () => {
    const frozen = await (
      await postJson("/v1/estimates/freeze", baseRequest)
    ).json();
    const res = await postJson("/v1/estimates/reload", {
      payload: { ...frozen, modelVersion: "0.0.1" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toMatch(/model_version_mismatch/);
  });

  it("EDGE: a tampered total is still returned as frozen, not recomputed", async () => {
    // Reload replays what was pinned; it does not re-run the estimator. This
    // documents that boundary explicitly so nobody later assumes reload
    // validates arithmetic - the inputHash is what detects tampering.
    const frozen = await (
      await postJson("/v1/estimates/freeze", baseRequest)
    ).json();
    const res = await postJson("/v1/estimates/reload", {
      payload: { ...frozen, totals: { expected: 999_999 } },
    });
    expect(res.status).toBe(200);
    const reloaded = await res.json();
    expect(reloaded.payload.totals.expected).toBe(999_999);
    expect(reloaded.payload.inputHash).toBe(frozen.inputHash);
  });
});
