/**
 * Atomic price-validation ledger + TF feature gating.
 *
 * These are the two claims the estimator makes that a customer can check
 * against reality: "this rate is what the vendor charges" and "this cost is
 * what the Terraform will create". Both must be false-able here.
 */
import { describe, expect, it } from "vitest";
import { loadFallbackFile } from "../rates/fallback-schema.ts";
import {
  assertFallbackMatchesLedger,
  confidenceForVerification,
  isValidationStale,
  loadPriceValidationLedger,
  staleValidations,
  validationAgeDays,
  validationForMeter,
  verificationWarnings,
  verifyMeter,
} from "../rates/price-validation.ts";
import { AZURE_FALLBACK_PRICES_PATH } from "../azure/azure-rates-adapter.ts";
import { AWS_FALLBACK_PRICES_PATH } from "../aws/aws-rates-adapter.ts";
import { GCP_FALLBACK_PRICES_PATH } from "../gcp/gcp-rates-adapter.ts";
import {
  assertManifestMatchesAllowlist,
  capabilityAvailability,
  gateCapabilitiesByTf,
  loadTfFeatureManifest,
} from "../tf/tf-feature-manifest.ts";
import { AZURE_TF_AUDIT_BILLABLE_METERS } from "../azure/tf-audit-reconciliation.ts";
import { createEstimate } from "../create-estimate.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";

const LEDGER = loadPriceValidationLedger();
/** Fixed clock so age assertions do not expire with the calendar. */
const NOW = new Date("2026-08-15T00:00:00.000Z");

/**
 * Estimates here assert on exact meters and totals, so rates come from the
 * in-repo fallback rather than whatever the live price APIs return today.
 */
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  },
  cache: createRatesCache(),
};

describe("price ledger — every billable rate is accounted for", () => {
  it("each fallback price matches the price the ledger says was checked", () => {
    for (const p of [
      AZURE_FALLBACK_PRICES_PATH,
      AWS_FALLBACK_PRICES_PATH,
      GCP_FALLBACK_PRICES_PATH,
    ]) {
      expect(() =>
        assertFallbackMatchesLedger(loadFallbackFile(p), LEDGER),
      ).not.toThrow();
    }
  });

  it("drift between a rate file and the ledger fails closed", () => {
    const doc = loadFallbackFile(AZURE_FALLBACK_PRICES_PATH);
    const tampered = {
      ...doc,
      meters: doc.meters.map((m) =>
        m.meterId === "eh-standard-tu" ? { ...m, unitPrice: 0.99 } : m,
      ),
    };
    expect(() => assertFallbackMatchesLedger(tampered, LEDGER)).toThrow(
      /eh-standard-tu/,
    );
  });

  it("a verified row carries a real observation, not just a verdict", () => {
    for (const row of LEDGER.meters.filter((m) => m.verdict === "verified")) {
      expect(row.verifiedAt, row.meterId).toBeTruthy();
      expect(row.sourceUrl, row.meterId).toMatch(/^https:\/\//);
      expect(Object.keys(row.observed).length, row.meterId).toBeGreaterThan(0);
    }
  });

  it("no row is left claiming a price the official list contradicts", () => {
    const mismatches = LEDGER.meters.filter((m) => m.verdict === "mismatch");
    expect(
      mismatches.map((m) => `${m.provider}/${m.meterId}`),
    ).toStrictEqual([]);
  });
});

describe("price ledger — age drives re-crawling", () => {
  it("age is measured from the last check, and never-checked is infinite", () => {
    const row = validationForMeter("eh-standard-tu", LEDGER);
    expect(row).toBeDefined();
    expect(validationAgeDays(row!, NOW)).toBe(5);
    expect(
      validationAgeDays(
        { ...row!, verifiedAt: null, blockedReason: undefined },
        NOW,
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("a row past its window is queued for re-crawl; a fresh one is not", () => {
    const row = validationForMeter("eh-standard-tu", LEDGER)!;
    const wayLater = new Date("2026-12-01T00:00:00.000Z");
    expect(isValidationStale(row, LEDGER, NOW)).toBe(false);
    expect(isValidationStale(row, LEDGER, wayLater)).toBe(true);
    expect(staleValidations(LEDGER, NOW)).toStrictEqual([]);
    expect(staleValidations(LEDGER, wayLater).length).toBeGreaterThan(0);
  });

  it("a price nobody can check stays untrusted even while its clock resets", () => {
    const row = validationForMeter("gce-outpost-scanner", LEDGER)!;
    expect(row.blockedReason).toBeTruthy();
    expect(Number.isFinite(validationAgeDays(row, NOW))).toBe(true);
    expect(verifyMeter("gce-outpost-scanner", LEDGER, NOW).trusted).toBe(false);
  });
});

describe("rate provenance reaches the estimate", () => {
  it("an unknown meter is treated as unverified, not as fine", () => {
    const v = verifyMeter("meter-that-does-not-exist", LEDGER, NOW);
    expect(v.verdict).toBe("unverified");
    expect(v.trusted).toBe(false);
  });

  it("a number the vendor does not publish cannot be a High-confidence line", () => {
    // Retired rows keep their verdict so the finding stays on the record.
    const invented = verifyMeter("acr-pull-bandwidth", LEDGER, NOW);
    expect(invented.verdict).toBe("unsupported-meter");
    expect(confidenceForVerification("High", invented)).toBe("Low");

    const real = verifyMeter("eh-standard-tu", LEDGER, NOW);
    expect(real.trusted).toBe(true);
    expect(confidenceForVerification("High", real)).toBe("High");
  });

  it("warnings name the problem meter and say what is wrong with it", () => {
    const w = verificationWarnings(
      ["eh-standard-tu", "acr-pull-bandwidth", "ecr-data-transfer"],
      LEDGER,
      NOW,
    );
    expect(w.join(" ")).not.toMatch(/eh-standard-tu/);
    expect(w.join(" ")).toMatch(/acr-pull-bandwidth.*no such meter/i);
    expect(w.join(" ")).toMatch(/ecr-data-transfer.*different service/i);
  });

  it("audit-only Azure lines are all vendor-backed", async () => {
    const res = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { accountCount: 10, avgStoredGB: 100 },
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    expect(res.lineItems.length).toBeGreaterThan(0);
    for (const item of res.lineItems) {
      expect(item.verification, item.meterId).toBeDefined();
      expect(item.verification?.trusted, item.meterId).toBe(true);
      expect(item.verification?.verdict, item.meterId).toBe("verified");
    }
    expect(res.confidence).toBe("High");
  });

  it("turning on a capability priced by a non-vendor meter drops confidence", async () => {
    // Azure and AWS are fully vendor-backed now, so the only capabilities that
    // can still demonstrate this are the GCP ones whose meters remain
    // unverifiable: ADS snapshots (no flat SKU exists) and the scanner VM.
    const res = await createEstimate({
      provider: "gcp",
      region: "us-central1",
      capabilities: { auditLogs: true, adsCloud: true },
      volume: { accountCount: 10, vmCount: 10, avgUsedDiskGB: 50 },
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    const ads = res.lineItems.find((i) => i.capability === "ads_cloud");
    expect(ads?.verification?.trusted).toBe(false);
    expect(ads?.confidence).toBe("Low");
    expect(res.confidence).toBe("Low");
    expect(res.warnings.join(" ")).toMatch(/pd-snapshot-storage/);
  });

  it("every Azure and AWS meter an estimate can bill is vendor-verified", async () => {
    // A milestone worth locking in: after retiring the invented registry and
    // scan meters, nothing on these two clouds prices from a number the vendor
    // does not publish. If this fails, an unverified meter crept back in.
    for (const [provider, region] of [
      ["azure", "eastus"],
      ["aws", "us-east-1"],
    ] as const) {
      const res = await createEstimate({
        provider,
        region,
        capabilities: {
          auditLogs: true,
          adsCloud: true,
          dspm: true,
          registry: true,
          serverless: true,
          egress: true,
        },
        volume: {
          accountCount: 10,
          avgStoredGB: 100,
          vmCount: 10,
          avgUsedDiskGB: 50,
          dataEstateGB: 1024,
          imageCount: 20,
          avgImageGB: 0.5,
          packageCount: 30,
          egressGB: 100,
        },
        now: NOW,
        ratesOptions: OFFLINE_RATES,
      });
      const untrusted = res.lineItems
        .filter((l) => !l.verification?.trusted)
        .map((l) => l.meterId);
      expect(untrusted, `${provider} has non-vendor meters`).toStrictEqual([]);
    }
  });
});

describe("TF feature manifest — the checkboxes decide what can be priced", () => {
  const manifest = loadTfFeatureManifest();

  it("meters derived from the Terraform equal the hand-kept audit allowlist", () => {
    expect(() =>
      assertManifestMatchesAllowlist(AZURE_TF_AUDIT_BILLABLE_METERS, manifest),
    ).not.toThrow();
  });

  it("an empty module deploys nothing and is reported as such", () => {
    const discovery = capabilityAvailability("azure", "discovery", manifest);
    expect(discovery.availability).toBe("not-deployed");
    expect(discovery.billableMeters).toStrictEqual([]);
    const mod = manifest.modules.find(
      (m) => m.moduleId === "DISCOVERY-assets_discovery",
    );
    expect(mod?.emptyFile).toBe(true);
    expect(mod?.deployed).toBe(false);
  });

  it("audit logs are deployed and carry exactly the Event Hub + blob meters", () => {
    const audit = capabilityAvailability("azure", "audit_logs", manifest);
    expect(audit.availability).toBe("deployed");
    expect([...audit.billableMeters].sort()).toStrictEqual(
      [...AZURE_TF_AUDIT_BILLABLE_METERS].sort(),
    );
  });

  it("AWS and GCP never borrow the Azure manifest", () => {
    for (const provider of ["aws", "gcp"] as const) {
      expect(
        capabilityAvailability(provider, "audit_logs", manifest).availability,
      ).toBe("no-connector-tf");
    }
  });

  it("as-deployed mode drops capabilities the Terraform will not create", () => {
    const gate = gateCapabilitiesByTf(
      "azure",
      { auditLogs: true, dspm: true, registry: true },
      "as-deployed",
      manifest,
    );
    expect(gate.effective.auditLogs).toBe(true);
    expect(gate.effective.dspm).toBe(false);
    expect(gate.effective.registry).toBe(false);
    expect(gate.excluded.map((e) => e.capability).sort()).toStrictEqual([
      "dspm",
      "registry",
    ]);
    expect(gate.warnings.join(" ")).toMatch(/does not deploy/);
  });

  it("what-if mode keeps them, so planning still works", () => {
    const gate = gateCapabilitiesByTf(
      "azure",
      { auditLogs: true, dspm: true },
      "what-if",
      manifest,
    );
    expect(gate.effective.dspm).toBe(true);
    expect(gate.excluded).toStrictEqual([]);
  });
});

describe("as-deployed estimates match what terraform apply would bill", () => {
  it("only TF-deployed meters appear, and the extra capability costs nothing", async () => {
    const deployed = new Set<string>(AZURE_TF_AUDIT_BILLABLE_METERS);
    const res = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true, dspm: true, registry: true, adsCloud: true },
      volume: {
        accountCount: 10,
        avgStoredGB: 100,
        dataEstateGB: 5000,
        imageCount: 100,
        vmCount: 20,
        avgUsedDiskGB: 50,
      },
      tfMode: "as-deployed",
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });

    expect(res.tfMode).toBe("as-deployed");
    for (const item of res.lineItems) {
      expect(deployed.has(item.meterId), `unexpected meter ${item.meterId}`).toBe(true);
    }
    expect(res.excludedCapabilities.map((e) => e.capability).sort()).toStrictEqual(
      ["ads_cloud", "dspm", "registry"],
    );
    expect(res.warnings.join(" ")).toMatch(/as-deployed mode: excluded/);
  });

  it("what-if on the same inputs costs strictly more and says why", async () => {
    const inputs = {
      provider: "azure" as const,
      region: "eastus",
      capabilities: { auditLogs: true, dspm: true },
      volume: { accountCount: 10, avgStoredGB: 100, dataEstateGB: 5000 },
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    };
    const asDeployed = await createEstimate({ ...inputs, tfMode: "as-deployed" as const });
    const whatIf = await createEstimate({ ...inputs, tfMode: "what-if" as const });

    expect(whatIf.totals.expected).toBeGreaterThan(asDeployed.totals.expected);
    expect(whatIf.lineItems.some((i) => i.capability === "dspm")).toBe(true);
    expect(asDeployed.lineItems.some((i) => i.capability === "dspm")).toBe(false);
    expect(whatIf.warnings.join(" ")).toMatch(/modeled · no connector TF/);
  });

  it("as-deployed on a provider with no connector TF prices nothing", async () => {
    const res = await createEstimate({
      provider: "aws",
      region: "us-east-1",
      capabilities: { auditLogs: true },
      volume: { accountCount: 10 },
      tfMode: "as-deployed",
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    expect(res.lineItems).toStrictEqual([]);
    expect(res.totals.expected).toBe(0);
    expect(res.excludedCapabilities.map((e) => e.capability)).toStrictEqual([
      "audit_logs",
    ]);
  });
});
