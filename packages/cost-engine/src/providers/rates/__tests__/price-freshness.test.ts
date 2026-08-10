/**
 * Package 16 — price freshness (cache TTL, STALE_DAYS, export Ack).
 */
import { describe, expect, it } from "vitest";
import {
  STALE_DAYS_WARN,
  STALE_DAYS_CRITICAL,
  RATES_CACHE_TTL_MS,
  FALLBACK_MAX_AGE_DAYS,
  ageDaysFromCapturedAt,
  evaluateRatesFreshness,
  assertExportAllowedForFreshness,
} from "../../../core/rates/age-days.ts";
import { createRatesCache, ratesCacheKey } from "../rates-cache.ts";
import { getRates, lookupUnitPrice } from "../get-rates.ts";
import { createAzureRatesAdapter } from "../../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../../gcp/gcp-rates-adapter.ts";
import { freezeEstimate } from "../../../core/rate-pinning.ts";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function forceFallbackAdapters() {
  return {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  };
}

describe("package 16 — REQ/AC freshness thresholds", () => {
  it("STALE_DAYS warn=7 critical=30; cache TTL 24h", () => {
    expect(STALE_DAYS_WARN).toBe(7);
    expect(STALE_DAYS_CRITICAL).toBe(30);
    expect(RATES_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(FALLBACK_MAX_AGE_DAYS).toBe(90);
  });

  it("ageDays thresholds unit-tested", () => {
    const fresh = evaluateRatesFreshness(
      "2026-07-25T00:00:00.000Z",
      "fallback",
      NOW,
    );
    expect(fresh.level).toBe("fresh");
    expect(fresh.requiresAckBeforeExport).toBe(false);

    const warn = evaluateRatesFreshness(
      "2026-07-18T00:00:00.000Z",
      "fallback",
      NOW,
    );
    expect(warn.ageDays).toBeGreaterThan(STALE_DAYS_WARN);
    expect(warn.level).toBe("warn");
    expect(warn.banner).toMatch(/warn/i);

    const critical = evaluateRatesFreshness(
      "2026-06-01T00:00:00.000Z",
      "fallback",
      NOW,
    );
    expect(critical.ageDays).toBeGreaterThan(STALE_DAYS_CRITICAL);
    expect(critical.level).toBe("critical");
    expect(critical.requiresAckBeforeExport).toBe(true);
    expect(() => assertExportAllowedForFreshness(critical)).toThrow(/Ack/i);
    expect(() =>
      assertExportAllowedForFreshness(critical, { ackCriticalStale: true }),
    ).not.toThrow();
  });
});

describe("package 16 — TEST cache + fallback banner", () => {
  it("cache hit skips network (adapter not called again)", async () => {
    let calls = 0;
    const cache = createRatesCache({ ttlMs: RATES_CACHE_TTL_MS });
    const base = createAzureRatesAdapter({ forceFallback: true, now: NOW });
    const counting = {
      provider: "azure" as const,
      async getRates(region: string) {
        calls += 1;
        return base.getRates(region);
      },
    };

    const a = await getRates("azure", "eastus", {
      adapters: { azure: counting },
      cache,
      now: NOW,
    });
    expect(a.ratesSource).toBe("fallback");
    expect(calls).toBe(1);

    const b = await getRates("azure", "eastus", {
      adapters: { azure: counting },
      cache,
      now: NOW,
    });
    expect(b.ratesSource).toBe("cache");
    expect(calls).toBe(1);
    expect(b.freshness).toBeTruthy();
    expect(b.rates.capturedAt).toBeTruthy();
  });

  it("expired cache refetches", async () => {
    let calls = 0;
    const cache = createRatesCache({ ttlMs: 1000 });
    const base = createAzureRatesAdapter({ forceFallback: true, now: NOW });
    const counting = {
      provider: "azure" as const,
      async getRates(region: string) {
        calls += 1;
        return base.getRates(region);
      },
    };
    const t0 = NOW.getTime();
    await getRates("azure", "eastus", {
      adapters: { azure: counting },
      cache,
      now: new Date(t0),
    });
    expect(calls).toBe(1);
    await getRates("azure", "eastus", {
      adapters: { azure: counting },
      cache,
      now: new Date(t0 + 2000),
    });
    expect(calls).toBe(2);
  });

  it("forceLive bypasses cache", async () => {
    let calls = 0;
    const cache = createRatesCache();
    const base = createAzureRatesAdapter({ forceFallback: true, now: NOW });
    const counting = {
      provider: "azure" as const,
      async getRates(region: string) {
        calls += 1;
        return base.getRates(region);
      },
    };
    await getRates("azure", "eastus", {
      adapters: { azure: counting },
      cache,
      now: NOW,
    });
    await getRates("azure", "eastus", {
      adapters: { azure: counting },
      cache,
      forceLive: true,
      now: NOW,
    });
    expect(calls).toBe(2);
  });

  it("API failure uses fallback with stale banner metadata", async () => {
    const failFetch = async () =>
      new Response("nope", { status: 503 }) as Response;
    const r = await getRates("azure", "eastus", {
      adapters: {
        azure: createAzureRatesAdapter({
          fetchImpl: failFetch,
          now: NOW,
        }),
      },
      cache: createRatesCache(),
      forceLive: true,
      now: NOW,
    });
    expect(r.ratesSource).toBe("fallback");
    expect(r.warnings.join(" ")).toMatch(/fallback|HTTP|stale|warn|critical|Rates/i);
    expect(r.freshness).toBeDefined();
    expect(Object.keys(r.rates.unitPrices).length).toBeGreaterThan(0);
  });

  it("getRates returns ratesAsOf/ratesSource/ageDays for UI (AC)", async () => {
    for (const provider of ["azure", "aws", "gcp"] as const) {
      const r = await getRates(provider, "default", {
        adapters: forceFallbackAdapters(),
        cache: createRatesCache(),
        forceLive: true,
        now: NOW,
      });
      expect(r.ratesSource).toMatch(/live|cache|fallback/);
      expect(r.rates.capturedAt).toBeTruthy();
      expect(r.ageDays).toBe(
        ageDaysFromCapturedAt(r.rates.capturedAt, NOW),
      );
      expect(r.freshness?.level).toMatch(/fresh|warn|critical/);
    }
  });
});

describe("package 16 — EDGE", () => {
  it("never invents $0 for missing meters (lookup undefined)", async () => {
    const r = await getRates("azure", "eastus", {
      adapters: forceFallbackAdapters(),
      cache: createRatesCache(),
      forceLive: true,
      now: NOW,
    });
    expect(lookupUnitPrice(r.rates, "totally-missing-meter")).toBeUndefined();
    expect(r.rates.unitPrices["totally-missing-meter"]).toBeUndefined();
  });

  it("critical-stale export requires Ack; embeds ratesAsOf + unitPrices", () => {
    const oldCard = {
      provider: "azure" as const,
      region: "eastus",
      currency: "USD" as const,
      unitPrices: { "eh-standard-tu": 0.03 },
      capturedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() =>
      freezeEstimate({
        result: {
          provider: "azure",
          lineItems: [],
          totals: { expected: 0 },
          confidence: "High",
        },
        rateCard: oldCard,
        inputs: {
          provider: "azure",
          region: "eastus",
          capabilities: {},
        },
        ratesSource: "fallback",
        now: NOW,
      }),
    ).toThrow(/Ack/i);

    const frozen = freezeEstimate({
      result: {
        provider: "azure",
        lineItems: [],
        totals: { expected: 0 },
        confidence: "High",
      },
      rateCard: oldCard,
      inputs: {
        provider: "azure",
        region: "eastus",
        capabilities: {},
      },
      ratesSource: "fallback",
      ackCriticalStale: true,
      now: NOW,
    });
    expect(frozen.ratesAsOf).toBe(oldCard.capturedAt);
    expect(frozen.rateCard.unitPrices["eh-standard-tu"]).toBe(0.03);
  });

  it("refresh script validates without rewriting capturedAt", async () => {
    const { execFileSync } = await import("node:child_process");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../../",
    );
    // Dry-run validation path: load files the script would write
    for (const rel of [
      "packages/cost-engine/src/providers/azure/fallback-prices.json",
      "packages/cost-engine/src/providers/aws/fallback-prices.json",
      "packages/cost-engine/src/providers/gcp/fallback-prices.json",
    ]) {
      const doc = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
      expect(doc.currency).toBe("USD");
      expect(doc.meters.length).toBeGreaterThan(0);
    }
    const rels = [
      "packages/cost-engine/src/providers/azure/fallback-prices.json",
      "packages/cost-engine/src/providers/aws/fallback-prices.json",
      "packages/cost-engine/src/providers/gcp/fallback-prices.json",
    ];
    const before = rels.map((rel) => fs.readFileSync(path.join(root, rel), "utf8"));

    const out = execFileSync("node", ["scripts/refresh-fallback-prices.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toMatch(/DONE updated=3\/3/);

    // Running the suite must not make stale prices look freshly captured:
    // capturedAt may only move when a price was actually observed at source.
    rels.forEach((rel, i) => {
      const after = fs.readFileSync(path.join(root, rel), "utf8");
      expect(after).toBe(before[i]);
      const doc = JSON.parse(after);
      expect(doc.currency).toBe("USD");
      for (const m of doc.meters) {
        expect(m.unitPrice).toBeGreaterThanOrEqual(0);
        expect(m.capturedAt).toMatch(/^\d{4}-/);
      }
    });
  });

  it("ratesCacheKey is stable", () => {
    expect(ratesCacheKey("Azure", " EastUS ")).toBe("Azure:eastus");
  });
});
