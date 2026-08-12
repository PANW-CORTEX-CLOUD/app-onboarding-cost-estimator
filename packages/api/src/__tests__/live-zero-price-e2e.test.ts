/**
 * REQ-23 T-23.1.3 — the $0 defences, exercised end to end over HTTP.
 *
 * The unit tests pin each defence in isolation: the tier walk in
 * `parseGcpBillingCatalog`, the currency check in `filterUsdUnitPrices`, and the
 * zero-guard in `mergeLiveOverFallback`. What none of them prove is that a
 * response leaving `/v1/rates` or `/v1/estimates` actually carries the verified
 * price — the value a customer is quoted travels through the parser, the merge,
 * the estimate and the serialiser, and a defence that holds in a unit test can
 * still be undone downstream.
 *
 * No new production seam was needed for this: `createApp({ ratesOptions })`
 * already threads adapters into every pricing route (@see app.ts CreateAppDeps),
 * and `createGcpRatesAdapter` already accepts `apiKey` + `fetchImpl`. Supplying
 * a fake key and a stub `fetch` drives the **live** path — the one that only
 * runs in production when `GCP_BILLING_API_KEY` is set, and which therefore has
 * never been covered here before.
 */
import { describe, expect, it } from "vitest";
import {
  createGcpRatesAdapter,
  createRatesCache,
  type GcpCatalogResponse,
} from "@cloud-connector/cost-engine";
import { createApp } from "../app.ts";

/** Pin the clock so freshness fields stay deterministic. */
const NOW = new Date("2026-08-12T00:00:00.000Z");

/** A meter the crawler-verified GCP fallback document prices above zero. */
const VERIFIED_METER = "gcs-standard-storage";
const VERIFIED_PRICE = 0.022;

/**
 * Build an app whose GCP adapter runs its **live** path against a stub catalog.
 *
 * @param body Catalog payload the stubbed Billing Catalog API returns.
 * @returns A Hono app wired to that stub.
 */
function appWithLiveCatalog(body: GcpCatalogResponse) {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

  return createApp({
    ratesOptions: {
      adapters: {
        gcp: createGcpRatesAdapter({
          apiKey: "test-key-not-a-secret",
          fetchImpl,
          now: NOW,
        }),
      },
      // Fresh cache per app: a shared one would let the first test's resolution
      // satisfy the second, so a regression could hide behind a cache hit.
      cache: createRatesCache(),
      forceLive: true,
      now: NOW,
    },
  });
}

/**
 * One SKU, expressed the way the Billing Catalog expresses a free allowance:
 * tier 0 free from unit 0, the real rate from the next tier up.
 *
 * @param meterId Meter to price.
 * @param chargedNanos Nanos of the charged tier.
 * @returns A catalog response.
 */
function freeAllowanceCatalog(meterId: string, chargedNanos: number): GcpCatalogResponse {
  return {
    skus: [
      {
        meterId,
        pricingInfo: [
          {
            pricingExpression: {
              tieredRates: [
                { startUsageAmount: 0, unitPrice: { currencyCode: "USD" } },
                {
                  startUsageAmount: 100,
                  unitPrice: { currencyCode: "USD", units: "0", nanos: chargedNanos },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("REQ-23 — a live $0 never reaches the customer as a price", () => {
  it("GET /v1/rates prices a free-allowance SKU from its charged tier, not $0", async () => {
    const app = appWithLiveCatalog(freeAllowanceCatalog(VERIFIED_METER, 90_000_000));
    const res = await app.request("/v1/rates?provider=gcp&region=us-central1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ratesSource).toBe("live");
    // 0.09 from the charged tier — not 0 from the free head, and not the
    // fallback's 0.022 either, because this is a real live re-price.
    expect(body.unitPrices[VERIFIED_METER]).toBeCloseTo(0.09);
    expect(body.warnings.join(" ")).toMatch(/free allowance/i);
  });

  it("GET /v1/rates keeps the verified price when the live catalog says $0", async () => {
    // Every tier free: the parser cannot tell this from a truncated payload
    // (proto3 omits defaults), so the merge is what has to refuse it.
    const allFree: GcpCatalogResponse = {
      skus: [
        {
          meterId: VERIFIED_METER,
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [{ startUsageAmount: 0, unitPrice: { currencyCode: "USD" } }],
              },
            },
          ],
        },
      ],
    };
    const app = appWithLiveCatalog(allFree);
    const res = await app.request("/v1/rates?provider=gcp&region=us-central1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unitPrices[VERIFIED_METER]).toBe(VERIFIED_PRICE);
    expect(body.warnings.join(" ")).toMatch(/live lookup returned \$0/);
    expect(body.warnings.join(" ")).toMatch(/failed lookup, not a price drop/);
  });

  it("GET /v1/rates ignores a live price whose currency the catalog never stated", async () => {
    const noCurrency: GcpCatalogResponse = {
      skus: [
        {
          meterId: VERIFIED_METER,
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [{ startUsageAmount: 0, unitPrice: { units: "9" } }],
              },
            },
          ],
        },
      ],
    };
    const app = appWithLiveCatalog(noCurrency);
    const res = await app.request("/v1/rates?provider=gcp&region=us-central1");

    expect(res.status).toBe(200);
    const body = await res.json();
    // The only live meter was dropped, so the adapter falls back wholesale
    // rather than serving a card built from nothing.
    expect(body.unitPrices[VERIFIED_METER]).toBe(VERIFIED_PRICE);
    expect(body.warnings.join(" ")).toMatch(/no currency stated/);
  });

  it("POST /v1/estimates does not bill a customer $0 for a meter the catalog zeroed", async () => {
    // The assertion that matters most: a zeroed rate must not travel all the way
    // into a quoted line item. Priced through the same route the UI calls.
    const allFree: GcpCatalogResponse = {
      skus: [
        {
          meterId: VERIFIED_METER,
          pricingInfo: [
            {
              pricingExpression: {
                tieredRates: [{ startUsageAmount: 0, unitPrice: { currencyCode: "USD" } }],
              },
            },
          ],
        },
      ],
    };
    const app = appWithLiveCatalog(allFree);
    // `auditLogs` is the capability that prices gcs-standard-storage on GCP
    // (@see providers/gcp/capability-meter-map.ts), and its drivers are the four
    // below — `assertCapabilitiesAreSized` rejects the request otherwise, which
    // is why an under-specified body earns a 400 rather than a $0 estimate.
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "gcp",
        region: "us-central1",
        capabilities: { auditLogs: true },
        volume: {
          accountCount: 10,
          ingressGBPerDay: 10,
          peakMBps: 1,
          peakEventsPerSec: 1000,
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const storageLine = body.lineItems.find(
      (li: { meterId: string }) => li.meterId === VERIFIED_METER,
    );
    expect(storageLine).toBeDefined();
    // The whole point: the customer is quoted the verified rate, not $0.
    expect(storageLine.amount).toBeGreaterThan(0);
    expect(body.totals.expected).toBeGreaterThan(0);
    expect(body.warnings.join(" ")).toMatch(/live lookup returned \$0/);
    // EDGE: the guard must not have zeroed or NaN'd anything else on the way.
    expect(
      body.lineItems.every((li: { amount: number }) => Number.isFinite(li.amount)),
    ).toBe(true);
  });
});
