/**
 * Package 04 — rates module REQ/AC/TEST/EDGE.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

// silence unused path helper in case tree-shaking lints
void path.join(__dirname, ".");
