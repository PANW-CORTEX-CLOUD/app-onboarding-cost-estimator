/**
 * AWS RatesAdapter — Price List API shape with in-repo fallback for us-east-1.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RatesAdapter } from "../../core/ports/rates-adapter.interface.ts";
import {
  fallbackResult,
  loadFallbackFile,
  type RatesResult,
} from "../rates/fallback-schema.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AWS_DEFAULT_REGION = "us-east-1";
export const AWS_FALLBACK_PRICES_PATH = path.join(
  __dirname,
  "fallback-prices.json",
);

/**
 * Per-service, per-region price documents — the only place AWS publishes rates.
 * Used by scripts/validate-prices.mjs, which is where AWS refresh happens.
 * The bare `index.json` at this path is an offer directory and has no prices.
 */
export const AWS_PRICE_LIST_OFFER_BASE =
  "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws";

export type AwsRatesAdapterOptions = {
  fallbackPath?: string;
  /** Accepted for symmetry with the other adapters; AWS is always fallback. */
  forceFallback?: boolean;
  now?: Date;
};

/**
 * RatesAdapter for AWS.
 *
 * Serves the crawler-verified `fallback-prices.json` for `us-east-1` and says
 * plainly that there is no per-request live feed, rather than attempting a
 * fetch that cannot succeed. Never invents a $0 rate for a missing meter.
 */
export function createAwsRatesAdapter(
  opts: AwsRatesAdapterOptions = {},
): RatesAdapter {
  const fallbackPath = opts.fallbackPath ?? AWS_FALLBACK_PRICES_PATH;
  const now = opts.now ?? new Date();

  return {
    provider: "aws",
    async getRates(region: string): Promise<RatesResult> {
      const doc = loadFallbackFile(fallbackPath);
      const warnings: string[] = [];
      const effectiveRegion = region?.trim() || AWS_DEFAULT_REGION;
      if (effectiveRegion.toLowerCase() !== doc.region.toLowerCase()) {
        warnings.push(
          `unknown or unsupported aws region '${effectiveRegion}'; using fallback region '${doc.region}'`,
        );
      }

      if (opts.forceFallback) {
        return fallbackResult(doc, warnings, now);
      }

      // No per-request live path for AWS, and saying so is the honest answer.
      //
      // Two independent reasons, both verified against the real service:
      //   1. `offers/v1.0/aws/index.json` is an *offer index* — a directory of
      //      services — and carries no prices at all.
      //   2. Prices live in per-service, per-region documents, and none of
      //      their products carry a `meterId` attribute; they are keyed by
      //      `usagetype` plus a set of discriminating attributes. The parser
      //      this adapter used to call expected `attributes.meterId`, which
      //      AWS does not publish, so it could only ever succeed against a
      //      hand-written mock.
      //
      // Even with a correct parser, a per-request fetch is not viable: the
      // EC2 document alone is ~480 MB, and two of the meters here come from it.
      //
      // The refresh mechanism that does work is `pnpm rates:validate`, which
      // reads those documents offline, compares each price against
      // sources/price-validations.json and writes verified values into this
      // file. That is strictly better than a live fetch, because a live price
      // nobody checked is just a fresher unknown.
      warnings.push(
        "aws has no per-request live price feed (the Price List is per-service and up to ~480 MB); rates come from the crawler-verified fallback file — refresh with `pnpm rates:validate --write`",
      );
      return fallbackResult(doc, warnings, now);
    },
  };
}
