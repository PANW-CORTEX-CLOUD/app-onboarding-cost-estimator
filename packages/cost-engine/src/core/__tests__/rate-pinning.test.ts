/**
 * Package 13 — rate pinning / freeze export (core).
 */
import { describe, expect, it } from "vitest";
import { modelVersion } from "../../model-version.ts";
import type { EstimateInputs, RateCard } from "../models/estimate.types.ts";
import {
  FREEZE_TOTAL_TOLERANCE_USD,
  PINNED_RATES_WARN_AGE_DAYS,
  createInputHash,
  estimateExportFields,
  freezeEstimate,
  loadFrozenEstimate,
  pinnedRatesAgeWarning,
  rateCardFromFreeze,
  totalsWithinTolerance,
  validateExportSchema,
} from "../rate-pinning.ts";

const inputs: EstimateInputs = {
  provider: "azure",
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: { accountCount: 10 },
};

/**
 * Pinned clock. These fixtures freeze rate cards captured on fixed dates, so
 * without an explicit `now` the freshness gate compares them against the real
 * wall clock and the suite starts failing 30 days after the fixture date.
 */
const NOW = new Date("2026-07-05T00:00:00.000Z");

const rateCard: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "eh-standard-tu": 0.03,
    "eh-standard-ingress-events": 0.028,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("package 13 — REQ freeze export fields", () => {
  it("exports provider, modelVersion, ratesAsOf, inputHash", () => {
    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [
          {
            provider: "azure",
            capability: "audit_logs",
            meterId: "eh-standard-tu",
            amount: 21.9,
            confidence: "High",
          },
        ],
        totals: { expected: 21.9 },
        confidence: "High",
      },
      rateCard,
      inputs,
      now: NOW,
    });
    expect(frozen.provider).toBe("azure");
    expect(frozen.modelVersion).toBe(modelVersion);
    expect(frozen.ratesAsOf).toBe(rateCard.capturedAt);
    expect(frozen.inputHash).toMatch(/^[0-9a-f]{8}$/);
    expect(frozen.inputHash).toBe(createInputHash(inputs));
    expect(frozen.rateCard.unitPrices["eh-standard-tu"]).toBe(0.03);
    expect(frozen.disclaimer.length).toBeGreaterThan(20);
  });
});

describe("package 13 — AC / TEST golden freeze → mutate → re-pin", () => {
  it("re-loading frozen rates reproduces totals within $0.01 after live mutation", () => {
    const originalTotal = 21.9;
    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [
          {
            provider: "azure",
            capability: "audit_logs",
            meterId: "eh-standard-tu",
            amount: originalTotal,
            confidence: "High",
          },
        ],
        totals: { expected: originalTotal },
        confidence: "High",
      },
      rateCard,
      inputs,
      now: NOW,
    });

    const json = JSON.stringify(frozen);
    const liveMutated: RateCard = {
      ...rateCard,
      unitPrices: {
        "eh-standard-tu": 9.99,
        "eh-standard-ingress-events": 9.99,
      },
      capturedAt: "2026-07-28T00:00:00.000Z",
    };
    // Live path would change; pinned card must not.
    expect(liveMutated.unitPrices["eh-standard-tu"]).not.toBe(
      frozen.rateCard.unitPrices["eh-standard-tu"],
    );

    const loaded = loadFrozenEstimate(json);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const pinned = rateCardFromFreeze(loaded.payload);
    // Simulate re-estimate: quantity × pinned unit price (TU-hour style)
    const hours = 730;
    const tus = 1;
    const recomputed = tus * hours * pinned.unitPrices["eh-standard-tu"]!;
    expect(
      totalsWithinTolerance(recomputed, loaded.payload.totals.expected),
    ).toBe(true);
    expect(Math.abs(recomputed - originalTotal)).toBeLessThanOrEqual(
      FREEZE_TOTAL_TOLERANCE_USD,
    );

    const fromLive =
      tus * hours * liveMutated.unitPrices["eh-standard-tu"]!;
    expect(totalsWithinTolerance(fromLive, originalTotal)).toBe(false);
  });

  it("export schema validates provider and modelVersion", () => {
    const frozen = freezeEstimate({
      result: {
        provider: "aws",
        lineItems: [],
        totals: { expected: 0 },
        confidence: "High",
      },
      rateCard: {
        provider: "aws",
        region: "us-east-1",
        currency: "USD",
        unitPrices: { "kinesis-shard-hour": 0.015 },
        capturedAt: "2026-07-01T00:00:00.000Z",
      },
      inputs: { ...inputs, provider: "aws", region: "us-east-1" },
      now: NOW,
    });
    expect(() => validateExportSchema(frozen)).not.toThrow();
    expect(frozen.provider).toBe("aws");
    expect(frozen.modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
    const meta = estimateExportFields(
      "aws",
      frozen.rateCard,
      frozen.inputs,
    );
    expect(meta.modelVersion).toBe(modelVersion);
    expect(meta.ratesAsOf).toBe(frozen.ratesAsOf);
  });
});

describe("package 13 — EDGE", () => {
  it("corrupt freeze payload fails closed", () => {
    const malformed = loadFrozenEstimate("{not json");
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.code).toBe("corrupt");

    const bad = loadFrozenEstimate({ provider: "azure" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_schema");

    const nanPrices = loadFrozenEstimate({
      schemaVersion: 1,
      provider: "azure",
      modelVersion: "0.1.0",
      ratesAsOf: "2026-01-01T00:00:00.000Z",
      inputHash: "deadbeef",
      rateCard: {
        provider: "azure",
        region: "eastus",
        currency: "USD",
        unitPrices: { "eh-standard-tu": Number.NaN },
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
      inputs,
      lineItems: [],
      totals: { expected: 1 },
      confidence: "High",
      disclaimer: "x",
      frozenAt: "2026-01-01T00:00:00.000Z",
      warnings: [],
    });
    expect(nanPrices.ok).toBe(false);
  });

  it("pinned rates older than 180 days warn", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    const oldCaptured = "2025-01-01T00:00:00.000Z";
    const age = pinnedRatesAgeWarning(oldCaptured, now);
    expect(age).toBeDefined();
    expect(age).toMatch(new RegExp(String(PINNED_RATES_WARN_AGE_DAYS)));

    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [],
        totals: { expected: 0 },
        confidence: "High",
      },
      rateCard: { ...rateCard, capturedAt: oldCaptured },
      inputs,
      now,
      ratesSource: "fallback",
      ackCriticalStale: true,
    });
    expect(frozen.warnings.some((w) => w.includes("ageDays"))).toBe(true);
  });

  it("modelVersion bump invalidates old pins gracefully", () => {
    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [],
        totals: { expected: 0 },
        confidence: "High",
      },
      rateCard,
      inputs,
      modelVersion: "0.0.1",
      now: NOW,
    });
    const loaded = loadFrozenEstimate(JSON.stringify(frozen), {
      currentModelVersion: "0.1.0",
    });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.code).toBe("model_version_mismatch");
      expect(loaded.error).toMatch(/re-estimate/i);
    }
  });

  it("pins unitTiers so a graduated meter reproduces its total on reload", () => {
    // REGRESSION: freezeEstimate and rateCardFromFreeze both rebuild the
    // RateCard field-by-field, and neither carried unitTiers when graduated
    // pricing was added. A frozen ladder-priced meter would reload with no
    // ladder and re-price flat at the first band throughout - a different
    // total from the one that was frozen, which is exactly what freezing
    // exists to prevent.
    const tiered: RateCard = {
      ...rateCard,
      unitPrices: { "blob-hot-lrs-capacity": 0.0208 },
      unitTiers: {
        "blob-hot-lrs-capacity": [
          { fromUnits: 0, unitPrice: 0.0208 },
          { fromUnits: 51_200, unitPrice: 0.02 },
          { fromUnits: 512_000, unitPrice: 0.0192 },
        ],
      },
    };
    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [],
        totals: { expected: 0 },
        confidence: "High",
      },
      rateCard: tiered,
      inputs,
      now: NOW,
    });
    expect(frozen.rateCard.unitTiers?.["blob-hot-lrs-capacity"]).toHaveLength(3);

    const loaded = loadFrozenEstimate(JSON.stringify(frozen));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const pinned = rateCardFromFreeze(loaded.payload);
    expect(pinned.unitTiers?.["blob-hot-lrs-capacity"]).toEqual(
      tiered.unitTiers!["blob-hot-lrs-capacity"],
    );

    // EDGE: a flat rate card must not grow an empty unitTiers key.
    const flat = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [],
        totals: { expected: 0 },
        confidence: "High",
      },
      rateCard,
      inputs,
      now: NOW,
    });
    expect(flat.rateCard.unitTiers).toBeUndefined();
    expect(rateCardFromFreeze(flat).unitTiers).toBeUndefined();
  });
});
