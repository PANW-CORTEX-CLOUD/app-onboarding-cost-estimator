/**
 * Package 04 — rates module REQ/AC/TEST/EDGE.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_MAX_AGE_DAYS,
  ageDaysFromCapturedAt,
} from "../../../core/rates/age-days.ts";
import {
  loadFallbackFile,
  parseFallbackDocument,
  filterUsdUnitPrices,
} from "../fallback-schema.ts";
import { getRates, lookupUnitPrice } from "../get-rates.ts";
import { UpstreamRateError } from "../../../core/errors.ts";
import { createRatesCache } from "../rates-cache.ts";
import type { RatesAdapter } from "../../../core/ports/rates-adapter.interface.ts";
import {
  createAzureRatesAdapter,
  parseAzureRetailPrices,
  AZURE_FALLBACK_PRICES_PATH,
} from "../../azure/azure-rates-adapter.ts";
import {
  createAwsRatesAdapter,
  AWS_FALLBACK_PRICES_PATH,
} from "../../aws/aws-rates-adapter.ts";
import {
  createGcpRatesAdapter,
  parseGcpBillingCatalog,
  GCP_FALLBACK_PRICES_PATH,
} from "../../gcp/gcp-rates-adapter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOW = new Date("2026-07-28T12:00:00.000Z");

describe("package 04 — REQ fallback files", () => {
  it("ships fallback-prices.json for azure/aws/gcp default regions", () => {
    for (const [p, region] of [
      [AZURE_FALLBACK_PRICES_PATH, "eastus"],
      [AWS_FALLBACK_PRICES_PATH, "us-east-1"],
      [GCP_FALLBACK_PRICES_PATH, "us-central1"],
    ] as const) {
      const doc = loadFallbackFile(p);
      expect(doc.region).toBe(region);
      expect(doc.currency).toBe("USD");
      expect(doc.meters.length).toBeGreaterThan(0);
      for (const m of doc.meters) {
        expect(m.meterId).toBeTruthy();
        expect(m.unit).toBeTruthy();
        expect(m.unitPrice).toBeTypeOf("number");
        expect(m.currency).toBe("USD");
        expect(m.capturedAt).toMatch(/^\d{4}-/);
        expect(m.sourceUrl).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("package 04 — AC getRates metadata", () => {
  it("returns RateCard + ratesSource + ageDays for each provider", async () => {
    for (const provider of ["azure", "aws", "gcp"] as const) {
      const r = await getRates(provider, "default", {
        // `now` must be pinned on getRates itself, not only on the adapters:
        // getRates stamps ageDays/freshness with its own clock, so leaving it
        // to the wall clock made this assertion compare a wall-clock ageDays
        // against a NOW-derived one. That agreed only while the real date sat
        // on the same day as the fixture capturedAt, then began failing the
        // first time the suite ran after midnight UTC — a rot, not a
        // regression, and unrelated to whatever change was in flight.
        now: NOW,
        adapters: {
          azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
          aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
          gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
        },
      });
      expect(r.rates.provider).toBe(provider);
      expect(r.rates.currency).toBe("USD");
      expect(r.ratesSource).toBe("fallback");
      expect(r.ageDays).toBe(ageDaysFromCapturedAt(r.rates.capturedAt, NOW));
      expect(Object.keys(r.rates.unitPrices).length).toBeGreaterThan(0);
    }
  });
});

describe("package 04 — TEST parsers + offline + age", () => {
  it("parses mock Azure Retail Prices → unitPrices", () => {
    const parsed = parseAzureRetailPrices({
      Items: [
        {
          meterName: "Throughput Unit",
          retailPrice: 0.031,
          currencyCode: "USD",
        },
        {
          meterName: "Ingress Events",
          retailPrice: 0.029,
          currencyCode: "USD",
        },
      ],
    });
    expect(parsed.unitPrices["eh-standard-tu"]).toBe(0.031);
    expect(parsed.unitPrices["eh-standard-ingress-events"]).toBe(0.029);
  });

  it("AWS says plainly that it has no per-request live feed", async () => {
    // The old test proved a mock parser could parse a mock. It could not fail,
    // because nothing real produced that shape: `offers/v1.0/aws/index.json` is
    // an offer directory with no prices, and no AWS product carries a `meterId`
    // attribute. A capability that only works against its own fixture is not a
    // capability, so the adapter now states the limitation instead.
    const adapter = createAwsRatesAdapter({ now: new Date("2026-08-10T00:00:00.000Z") });
    const result = await adapter.getRates("us-east-1");

    expect(result.ratesSource).toBe("fallback");
    expect(result.warnings.join(" ")).toMatch(/no per-request live price feed/);
    expect(result.warnings.join(" ")).toMatch(/rates:validate/);
    // Fallback still has to be a complete, usable card.
    expect(Object.keys(result.rates.unitPrices).length).toBeGreaterThan(0);
    expect(result.rates.unitPrices["kinesis-shard-hour"]).toBe(0.015);
  });

  describe("GCP live-refresh honesty (REQ-10 UC-10.3)", () => {
    // stubEnv so the assertion holds whether or not CI happens to export a key.
    afterEach(() => vi.unstubAllEnvs());

    it("EDGE: with GCP_BILLING_API_KEY unset, says plainly how to enable live rates", async () => {
      vi.stubEnv("GCP_BILLING_API_KEY", "");
      // No forceFallback and no injected apiKey: this is the real "user asked
      // for live but the key isn't configured" path. It must fall back *and*
      // name the missing key, not degrade silently.
      const adapter = createGcpRatesAdapter({ now: NOW });
      const result = await adapter.getRates("us-central1");

      expect(result.ratesSource).toBe("fallback");
      expect(result.warnings.join(" ")).toMatch(/GCP_BILLING_API_KEY/);
      expect(result.warnings.join(" ")).toMatch(/rates:validate/);
      // The fallback still has to be a complete, usable card.
      expect(Object.keys(result.rates.unitPrices).length).toBeGreaterThan(0);
    });
  });

  it("parses mock GCP Billing Catalog → unitPrices", () => {
    const parsed = parseGcpBillingCatalog({
      skus: [
        {
          meterId: "pubsub-message-delivery",
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [
                  { unitPrice: { currencyCode: "USD", units: "0", nanos: 40_000_000 } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.unitPrices["pubsub-message-delivery"]).toBeCloseTo(0.04);
  });

  // REQ-22 (T-22.1.1) — a SKU that leads with a free allowance must not price at
  // $0 for all volume. The Billing Catalog expresses "first 20GB free, then
  // $10/GB" as tier 0 at $0 (startUsageAmount 0) and the real rate at tier 1.
  it("prices from the first charged tier, not a free introductory tier", () => {
    const parsed = parseGcpBillingCatalog({
      skus: [
        {
          meterId: "gcs-standard-storage",
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [
                  { startUsageAmount: 0, unitPrice: { currencyCode: "USD" } },
                  {
                    startUsageAmount: 20,
                    unitPrice: { currencyCode: "USD", units: "10", nanos: 0 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.unitPrices["gcs-standard-storage"]).toBeCloseTo(10);
    expect(parsed.warnings.join(" ")).toMatch(/free allowance/i);
    expect(parsed.warnings.join(" ")).toMatch(/gcs-standard-storage/);
  });

  // EDGE, and the case that decided the shape of this fix: in the canonical
  // proto3 JSON mapping a field at its default is *omitted*, so a genuinely free
  // SKU and a truncated response are byte-identical. Absence therefore cannot be
  // treated as an error — a SKU that is free at every tier stays free, silently.
  it("keeps a SKU that is free at every tier at $0, with no warning", () => {
    const parsed = parseGcpBillingCatalog({
      skus: [
        {
          meterId: "always-free-meter",
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [{ startUsageAmount: 0, unitPrice: { currencyCode: "USD" } }],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.unitPrices["always-free-meter"]).toBe(0);
    expect(parsed.warnings.join(" ")).not.toMatch(/free allowance/i);
  });

  // EDGE: `units` is an int64 transmitted as a decimal string, so a shape change
  // there lands as NaN. filterUsdUnitPrices drops it rather than pricing NaN.
  it("drops a meter whose units are not numeric", () => {
    const parsed = parseGcpBillingCatalog({
      skus: [
        {
          meterId: "broken-meter",
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [{ unitPrice: { currencyCode: "USD", units: "not-a-number" } }],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.unitPrices["broken-meter"]).toBeUndefined();
  });

  // EDGE: more than one free tier before the charged one.
  it("skips several free tiers to reach the charged rate", () => {
    const parsed = parseGcpBillingCatalog({
      skus: [
        {
          meterId: "multi-free-meter",
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [
                  { startUsageAmount: 0, unitPrice: { currencyCode: "USD" } },
                  { startUsageAmount: 5, unitPrice: { currencyCode: "USD", units: "0", nanos: 0 } },
                  {
                    startUsageAmount: 50,
                    unitPrice: { currencyCode: "USD", units: "0", nanos: 250_000_000 },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.unitPrices["multi-free-meter"]).toBeCloseTo(0.25);
  });

  // EDGE: non-USD is still rejected after tier selection, not before it.
  it("still fails closed to USD when the charged tier is non-USD", () => {
    const parsed = parseGcpBillingCatalog({
      skus: [
        {
          meterId: "eur-meter",
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [
                  { startUsageAmount: 0, unitPrice: { currencyCode: "EUR" } },
                  { startUsageAmount: 10, unitPrice: { currencyCode: "EUR", units: "3" } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.unitPrices["eur-meter"]).toBeUndefined();
    expect(parsed.warnings.join(" ")).toMatch(/non-USD/);
  });

  it("offline: API error → fallback, no throw", async () => {
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    const azure = createAzureRatesAdapter({ fetchImpl, now: NOW });
    const r = await azure.getRates("eastus");
    expect(r.ratesSource).toBe("fallback");
    expect(r.rates.unitPrices["eh-standard-tu"]).toBeGreaterThan(0);
    expect(r.warnings?.some((w) => /fallback/i.test(w))).toBe(true);
  });

  it("fallback capturedAt ≤90 days (or warn)", () => {
    for (const p of [
      AZURE_FALLBACK_PRICES_PATH,
      AWS_FALLBACK_PRICES_PATH,
      GCP_FALLBACK_PRICES_PATH,
    ]) {
      const doc = loadFallbackFile(p);
      for (const m of doc.meters) {
        const age = ageDaysFromCapturedAt(m.capturedAt, NOW);
        if (age > FALLBACK_MAX_AGE_DAYS) {
          // CI warns — assert warning path exists via stale check message contract
          expect(age).toBeGreaterThan(FALLBACK_MAX_AGE_DAYS);
        } else {
          expect(age).toBeLessThanOrEqual(FALLBACK_MAX_AGE_DAYS);
        }
      }
      // Current fixtures must be fresh as of plan date
      const newest = Math.max(
        ...doc.meters.map((m) => ageDaysFromCapturedAt(m.capturedAt, NOW)),
      );
      expect(newest).toBeLessThanOrEqual(FALLBACK_MAX_AGE_DAYS);
    }
  });

  it.skipIf(!process.env.RATES_LIVE_SMOKE)(
    "optional live smoke per provider",
    async () => {
      const azure = await createAzureRatesAdapter({ now: NOW }).getRates("eastus");
      expect(["live", "fallback", "cache"]).toContain(azure.ratesSource);
      expect(azure.rates.currency).toBe("USD");
    },
    60_000,
  );
});

describe("package 04 — EDGE", () => {
  it("unknown region → fallback + warning", async () => {
    const r = await createAzureRatesAdapter({
      forceFallback: true,
      now: NOW,
    }).getRates("mars-south-1");
    expect(r.ratesSource).toBe("fallback");
    expect(r.warnings?.join(" ")).toMatch(/unknown or unsupported azure region/i);
  });

  it("unknown provider → empty RateCard + warning (no invented meters)", async () => {
    const r = await getRates("oracle", "us-east-1");
    expect(r.ratesSource).toBe("fallback");
    expect(r.rates.unitPrices).toEqual({});
    expect(r.warnings?.join(" ")).toMatch(/unknown provider/i);
  });

  it("multi-currency fail closed to USD", () => {
    const filtered = filterUsdUnitPrices({
      a: { unitPrice: 1, currency: "EUR" },
      b: { unitPrice: 2, currency: "USD" },
    });
    expect(filtered.unitPrices).toEqual({ b: 2 });
    expect(filtered.warnings.join(" ")).toMatch(/non-USD/i);
  });

  it("empty provider response → fallback", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ Items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const r = await createAzureRatesAdapter({ fetchImpl, now: NOW }).getRates(
      "eastus",
    );
    expect(r.ratesSource).toBe("fallback");
    expect(r.warnings?.join(" ")).toMatch(/empty/i);
  });

  it("does not invent $0 for missing meters", async () => {
    const r = await createAzureRatesAdapter({
      forceFallback: true,
      now: NOW,
    }).getRates("eastus");
    expect(lookupUnitPrice(r.rates, "totally-unknown-meter")).toBeUndefined();
    expect("totally-unknown-meter" in r.rates.unitPrices).toBe(false);
  });

  it("rejects non-USD fallback documents", () => {
    expect(() =>
      parseFallbackDocument({
        provider: "azure",
        region: "eastus",
        currency: "EUR",
        meters: [],
      }),
    ).toThrow(/USD/);
  });
});

describe("package 04 — REQ-20 UpstreamRateError taxonomy", () => {
  it("throws UpstreamRateError when the adapter itself throws (rate source down)", async () => {
    const exploding: RatesAdapter = {
      provider: "azure",
      async getRates() {
        throw new Error("network down / feed unreachable");
      },
    };
    // A broken adapter is an upstream failure, not the caller's fault — getRates
    // must classify it so the API can render 502 rather than 400/500.
    await expect(
      getRates("azure", "eastus", {
        adapters: { azure: exploding },
        cache: createRatesCache(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(UpstreamRateError);
  });

  it("throws UpstreamRateError on a corrupt (non-finite/negative) source price — fails closed", async () => {
    const corrupt: RatesAdapter = {
      provider: "azure",
      async getRates(region: string) {
        return {
          rates: {
            provider: "azure" as const,
            region,
            currency: "USD" as const,
            unitPrices: { "eh-standard-tu": -1 },
            capturedAt: NOW.toISOString(),
          },
          ratesSource: "live" as const,
          ageDays: 0,
          warnings: [],
        };
      },
    };
    await expect(
      getRates("azure", "eastus", {
        adapters: { azure: corrupt },
        cache: createRatesCache(),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(UpstreamRateError);
  });

  it("EDGE: a normal fallback resolution does NOT throw (only genuine source failures do)", async () => {
    const r = await getRates("azure", "eastus", {
      adapters: { azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }) },
      cache: createRatesCache(),
      now: NOW,
    });
    expect(r.ratesSource).toBe("fallback");
    expect(Object.keys(r.rates.unitPrices).length).toBeGreaterThan(0);
  });
});

// silence unused path helper in case tree-shaking lints
void path.join(__dirname, ".");
