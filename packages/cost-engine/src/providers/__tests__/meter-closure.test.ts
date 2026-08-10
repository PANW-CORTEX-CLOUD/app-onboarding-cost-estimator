/**
 * REQ-1/REQ-2 — the meter closure invariant.
 *
 * Three places name meters and they must agree:
 *   1. the estimators, which emit line items
 *   2. the capability meter maps + docs, which claim what gets billed
 *   3. sources/price-validations.json, which records whether the price is real
 *
 * Changing an estimator's meter used to leave the other two describing a meter
 * nobody bills, and nothing failed: the map↔doc test only compared the map with
 * the doc, and the ledger test only compared the ledger with the rate file. The
 * estimators sat outside every check. This closes the loop by driving real
 * estimates and asserting on the meters they actually emit.
 *
 * If this fails, do not relax it — one of the three is lying about what the
 * customer will be charged for.
 */
import { describe, expect, it } from "vitest";
import { createEstimate } from "../create-estimate.ts";
import { azureCapabilityMeterMap } from "../azure/capability-meter-map.ts";
import { awsCapabilityMeterMap } from "../aws/capability-meter-map.ts";
import { gcpCapabilityMeterMap } from "../gcp/capability-meter-map.ts";
import { loadPriceValidationLedger } from "../rates/price-validation.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";
import type { CloudProvider } from "../../core/models/estimate.types.ts";

const NOW = new Date("2026-08-15T00:00:00.000Z");
const LEDGER = loadPriceValidationLedger();

const MAPS: Record<CloudProvider, readonly { capability: string; meterId: string }[]> = {
  azure: azureCapabilityMeterMap,
  aws: awsCapabilityMeterMap,
  gcp: gcpCapabilityMeterMap,
};

const REGIONS: Record<CloudProvider, string> = {
  azure: "eastus",
  aws: "us-east-1",
  gcp: "us-central1",
};

function offlineRates() {
  return {
    adapters: {
      azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
      aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
      gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
    },
    cache: createRatesCache(),
  };
}

/** Every capability on, with enough volume that each emits a real line. */
const ALL_CAPABILITIES = {
  discovery: true,
  auditLogs: true,
  adsCloud: true,
  adsOutpost: true,
  dspm: true,
  registry: true,
  serverless: true,
  egress: true,
};

const FULL_VOLUME = {
  accountCount: 10,
  avgStoredGB: 500,
  vmCount: 25,
  avgUsedDiskGB: 80,
  dataEstateGB: 4096,
  pctScanned: 25,
  imageCount: 200,
  avgImageGB: 0.4,
  packageCount: 150,
  egressGB: 250,
  scansPerMonth: 4,
};

async function estimateEverything(provider: CloudProvider) {
  return createEstimate({
    provider,
    region: REGIONS[provider],
    capabilities: ALL_CAPABILITIES,
    volume: FULL_VOLUME,
    tfMode: "what-if",
    now: NOW,
    ratesOptions: offlineRates(),
  });
}

describe("every meter an estimator emits is declared and validated", () => {
  for (const provider of ["azure", "aws", "gcp"] as const) {
    it(`${provider}: emitted meters appear in the capability map`, async () => {
      const res = await estimateEverything(provider);
      expect(res.lineItems.length).toBeGreaterThan(0);

      const declared = new Set(MAPS[provider].map((r) => r.meterId));
      const undeclared = [
        ...new Set(
          res.lineItems.map((l) => l.meterId).filter((id) => !declared.has(id)),
        ),
      ];
      expect(
        undeclared,
        `${provider} bills meters the capability map does not declare — docs/CLOUD_COST_MODEL.md is out of date`,
      ).toStrictEqual([]);
    });

    it(`${provider}: emitted meters have a price-validation row`, async () => {
      const res = await estimateEverything(provider);
      const known = new Set(
        LEDGER.meters.filter((m) => m.provider === provider).map((m) => m.meterId),
      );
      const unvalidated = [
        ...new Set(
          res.lineItems.map((l) => l.meterId).filter((id) => !known.has(id)),
        ),
      ];
      expect(
        unvalidated,
        `${provider} bills meters with no row in sources/price-validations.json`,
      ).toStrictEqual([]);
    });

    it(`${provider}: every emitted line carries a verification verdict`, async () => {
      const res = await estimateEverything(provider);
      for (const line of res.lineItems) {
        expect(line.verification, line.meterId).toBeDefined();
        expect(line.verification?.verdict, line.meterId).toBeTruthy();
      }
    });

    it(`${provider}: capability ids in the map match the ids estimators emit`, async () => {
      const res = await estimateEverything(provider);
      const mapped = new Set(MAPS[provider].map((r) => r.capability));
      const emitted = [...new Set(res.lineItems.map((l) => l.capability))];
      const unmapped = emitted.filter((c) => !mapped.has(c));
      expect(
        unmapped,
        `${provider} emits capability ids absent from the meter map`,
      ).toStrictEqual([]);
    });
  }

  it("the retired per-GB scan meters are billed by nobody", async () => {
    // These three were invented by this repo; the vendors publish no such
    // meter. They stay in the ledger as `unsupported-meter` so the claim is
    // still recorded and falsifiable, but no estimate may charge for them.
    const retired = [
      "blob-data-read-ops",
      "s3-data-retrieval-band",
      "gcs-data-read-band",
    ];
    for (const provider of ["azure", "aws", "gcp"] as const) {
      const res = await estimateEverything(provider);
      for (const line of res.lineItems) {
        expect(retired, `${provider} still bills ${line.meterId}`).not.toContain(
          line.meterId,
        );
      }
    }
  });
});
