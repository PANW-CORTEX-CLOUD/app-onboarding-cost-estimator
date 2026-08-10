/**
 * Unit tests for estimate CLI golden assertions (no live HTTP).
 * Run: node --test scripts/lib/estimate-check.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AZURE_AUDIT_FALLBACK_GOLDEN,
  AZURE_TF_AUDIT_BILLABLE_METERS,
  assertAzureAuditGolden,
  assertDiscoveryOnlyZero,
  amountsClose,
  formatEstimateTable,
} from "./estimate-check.mjs";

describe("estimate-check assertAzureAuditGolden", () => {
  const rates = {
    unitPrices: {
      "eh-standard-tu": 0.03,
      "blob-hot-lrs-capacity": 0.0208,
      "eh-standard-ingress-events": 0.028,
    },
    ratesSource: "fallback",
  };

  const goodEstimate = {
    provider: "azure",
    ratesSource: "fallback",
    confidence: "High",
    totals: { expected: AZURE_AUDIT_FALLBACK_GOLDEN.totalsExpected },
    lineItems: AZURE_TF_AUDIT_BILLABLE_METERS.map((meterId) => ({
      meterId,
      amount: AZURE_AUDIT_FALLBACK_GOLDEN[meterId],
      capability: "audit_logs",
    })),
  };

  it("passes fallback golden", () => {
    const r = assertAzureAuditGolden(goodEstimate, rates);
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("fails closed on wrong meters", () => {
    const bad = {
      ...goodEstimate,
      lineItems: [{ meterId: "invented", amount: 1, capability: "audit_logs" }],
      totals: { expected: 1 },
    };
    const r = assertAzureAuditGolden(bad, rates);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /meters expected/i);
  });

  it("fails closed on TU amount drift", () => {
    const bad = {
      ...goodEstimate,
      lineItems: goodEstimate.lineItems.map((l) =>
        l.meterId === "eh-standard-tu" ? { ...l, amount: 99 } : l,
      ),
      totals: { expected: 99 },
    };
    const r = assertAzureAuditGolden(bad, rates);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /eh-standard-tu/);
  });

  it("live rates: checks TU = price × 730 without absolute fallback pin", () => {
    const liveRates = {
      unitPrices: { "eh-standard-tu": 0.04, "blob-hot-lrs-capacity": 0.02 },
      ratesSource: "live",
    };
    const estimate = {
      provider: "azure",
      ratesSource: "live",
      totals: { expected: 0.04 * 730 + 5 + 0.02 },
      lineItems: [
        { meterId: "eh-standard-tu", amount: 0.04 * 730, capability: "audit_logs" },
        {
          meterId: "eh-standard-ingress-events",
          amount: 5,
          capability: "audit_logs",
        },
        {
          meterId: "blob-hot-lrs-capacity",
          amount: 0.02,
          capability: "audit_logs",
        },
      ],
    };
    const r = assertAzureAuditGolden(estimate, liveRates);
    assert.equal(r.ok, true, r.errors.join("; "));
  });
});

describe("estimate-check assertDiscoveryOnlyZero", () => {
  it("passes $0 empty", () => {
    const r = assertDiscoveryOnlyZero({
      provider: "azure",
      lineItems: [],
      totals: { expected: 0 },
    });
    assert.equal(r.ok, true);
  });

  it("fails when lineItems present", () => {
    const r = assertDiscoveryOnlyZero({
      provider: "azure",
      lineItems: [{ meterId: "x", amount: 1 }],
      totals: { expected: 1 },
    });
    assert.equal(r.ok, false);
  });
});

describe("estimate-check helpers", () => {
  it("amountsClose tolerance", () => {
    assert.equal(amountsClose(21.9, 21.905), true);
    assert.equal(amountsClose(21.9, 22.0), false);
  });

  it("formatEstimateTable includes meters", () => {
    const text = formatEstimateTable({
      provider: "azure",
      confidence: "High",
      ratesSource: "fallback",
      totals: { expected: 30.85 },
      lineItems: [
        { meterId: "eh-standard-tu", amount: 21.9, capability: "audit_logs" },
      ],
    });
    assert.match(text, /eh-standard-tu/);
    assert.match(text, /21\.9000/);
  });
});

describe("estimate.mjs parseArgs", async () => {
  const { parseArgs, buildRequestFromFlags } = await import("../estimate.mjs");

  it("ignores lone -- from pnpm", () => {
    const args = parseArgs([
      "--",
      "--provider",
      "azure",
      "--region",
      "eastus",
      "--cap",
      "auditLogs",
    ]);
    assert.equal(args.provider, "azure");
    assert.deepEqual(args.caps, ["auditLogs"]);
  });

  it("buildRequestFromFlags defaults auditLogs when no --cap", () => {
    const body = buildRequestFromFlags(
      parseArgs(["--provider", "aws", "--region", "us-east-1"]),
    );
    assert.equal(body.provider, "aws");
    assert.equal(body.capabilities.auditLogs, true);
  });
});
