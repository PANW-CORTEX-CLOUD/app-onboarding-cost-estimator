/**
 * Package 25 — EDGE+ hardening for engine packages 01–16.
 * Each `it` title contains `package NN — EDGE+` for the meta-gate scanner.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveMonthHours,
  isLeapYear,
} from "../core/hours.ts";
import {
  resolveVolumeSignals,
  parseRawStreamMetrics,
  LOG_CATEGORY_SETS,
} from "../core/volume-signals.ts";
import { loadFrozenEstimate } from "../core/rate-pinning.ts";
import { projectCosts } from "../core/project-costs.ts";
import type { RateCard } from "../core/models/estimate.types.ts";
import { estimateAzureAuditStream } from "../providers/azure/azure-stream-estimator.ts";
import { estimateAzureAuditStorage } from "../providers/azure/azure-storage-estimator.ts";
import { estimateAzureAds } from "../providers/azure/azure-ads-estimator.ts";
import { estimateAzureDspm } from "../providers/azure/azure-dspm-estimator.ts";
import { estimateAzureRegistryScan } from "../providers/azure/azure-registry-serverless.ts";
import { estimateAzureEgress } from "../providers/azure/azure-egress-estimator.ts";
import { createAzureRatesAdapter } from "../providers/azure/azure-rates-adapter.ts";
import { lookupUnitPrice } from "../providers/rates/get-rates.ts";
import {
  FORMULA_CHECKS,
  assertFormulaChecksNotSkippedByEnv,
} from "../providers/formula-regression/registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../");

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "eh-standard-tu": 0.03,
    "eh-standard-ingress-events": 0.028,
    "blob-hot-lrs-capacity": 0.018,
    "managed-disk-snapshot": 0.05,
    "vm-outpost-scanner": 0.096,
    "blob-data-read-ops": 0.004,
    "azure-egress-gb": 0.087,
    "functions-scan-ops": 0.002,
    "azure-egress-gb": 0.087,
  },
  capturedAt: "2026-07-01T00:00:00.000Z",
};

describe("package 01 — EDGE+", () => {
  it("package 01 — EDGE+ CLOUD_COST_MODEL documents GovCloud and discovery gaps", () => {
    const doc = fs.readFileSync(
      path.join(REPO_ROOT, "docs/CLOUD_COST_MODEL.md"),
      "utf8",
    );
    expect(doc).toMatch(/GovCloud|Government|FedRAMP/i);
    expect(doc).toMatch(/gap|empty|missing/i);
  });
});

describe("package 02 — EDGE+", () => {
  it("package 02 — EDGE+ web does not deep-import cost-engine provider formula paths", () => {
    const webSrc = path.join(REPO_ROOT, "apps/web/src");
    const hits: string[] = [];
    function walk(dir: string) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(ent.name)) {
          const t = fs.readFileSync(p, "utf8");
          if (
            /packages\/cost-engine\/src\/providers\//.test(t) ||
            /from ["'].*cost-engine\/src\//.test(t)
          ) {
            hits.push(path.relative(REPO_ROOT, p));
          }
        }
      }
    }
    walk(webSrc);
    expect(hits).toEqual([]);
  });
});

describe("package 03 — EDGE+", () => {
  it("package 03 — EDGE+ openapi.yaml present and no nested cost-estimator repo", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "openapi/openapi.yaml"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(REPO_ROOT, "cost-estimator"))).toBe(false);
  });
});

describe("package 04 — EDGE+", () => {
  it("package 04 — EDGE+ unknown region still yields USD fallback RateCard", async () => {
    const r = await createAzureRatesAdapter({
      forceFallback: true,
      now: new Date("2026-07-01T00:00:00.000Z"),
    }).getRates("not-a-real-region-xyz");
    expect(r.ratesSource).toMatch(/fallback/i);
    expect(r.rates.currency).toBe("USD");
    expect(Object.keys(r.rates.unitPrices).length).toBeGreaterThan(0);
  });
});

describe("package 05 — EDGE+", () => {
  it("package 05 — EDGE+ monthHours=720 rejected; leap year Feb 29 supported", () => {
    expect(() => resolveMonthHours({ monthHours: 720 })).toThrow(/720/);
    expect(isLeapYear(2024)).toBe(true);
    const feb = resolveMonthHours({
      convention: "actual",
      year: 2024,
      month: 2,
    });
    expect(feb.daysInMonth).toBe(29);
  });
});

describe("package 06 — EDGE+", () => {
  it("package 06 — EDGE+ zero ingress still bills minimum capacity when audit on", () => {
    const r = estimateAzureAuditStream(
      {
        enabled: true,
        region: "eastus",
        ingressGBPerDay: 0,
        peakMBps: 0,
        peakEventsPerSec: 0,
      },
      azureRates,
    );
    expect(r.provisionedCapacityUnits).toBeGreaterThanOrEqual(1);
    expect(r.totals.expected).toBeGreaterThan(0);
  });
});

describe("package 07 — EDGE+", () => {
  it("package 07 — EDGE+ ZRS redundancy fails closed", () => {
    expect(() =>
      estimateAzureAuditStorage(
        {
          enabled: true,
          region: "eastus",
          avgGB: 1,
          redundancy: "ZRS",
        },
        azureRates,
      ),
    ).toThrow(/fails closed|ZRS|redundancy|GRS/i);
  });
});

describe("package 08 — EDGE+", () => {
  it("package 08 — EDGE+ zero VMs with ADS on warns", () => {
    const r = estimateAzureAds(
      {
        enabled: true,
        region: "eastus",
        mode: "Cloud",
        vmCount: 0,
        avgUsedDiskGB: 100,
        scansPerMonth: 1,
        snapshotLifetimeHours: 24,
        monthHours: 730,
      },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/vmCount=0/i);
  });
});

describe("package 09 — EDGE+", () => {
  it("package 09 — EDGE+ 0 GB estate with DSPM on refuses silent precision", () => {
    expect(() =>
      estimateAzureDspm(
        {
          enabled: true,
          region: "eastus",
          dataEstateGB: 0,
          pctScanned: 10,
          scansPerMonth: 1,
        },
        azureRates,
      ),
    ).toThrow(/refuse silent precision|dataEstateGB/i);
  });
});

describe("package 10 — EDGE+", () => {
  it("package 10 — EDGE+ zero imageCount warns and does not invent repository storage meter", () => {
    const r = estimateAzureRegistryScan(
      {
        enabled: true,
        region: "eastus",
        imageCount: 0,
        avgImageGB: 1,
        scansPerMonth: 1,
      },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/imageCount=0/i);
    expect(
      r.lineItems.every((li) => !/repository.?storage|existing.?storage/i.test(li.meterId)),
    ).toBe(true);
  });
});

describe("package 11 — EDGE+", () => {
  it("package 11 — EDGE+ unknown destination zone excludes cost and warns", () => {
    const r = estimateAzureEgress(
      {
        enabled: true,
        region: "eastus",
        destinationZone: "mars-orbit",
        egressGB: 10,
      },
      azureRates,
    );
    expect(r.warnings.join(" ")).toMatch(/unknown|exclude/i);
    expect(r.totals.expected).toBe(0);
  });
});

describe("package 12 — EDGE+", () => {
  it("package 12 — EDGE+ invalid raw paste rejected; provider multipliers differ", () => {
    expect(() => parseRawStreamMetrics("")).toThrow(/invalid|malformed|cannot/i);
    // AWS max is 2 categories — exceeding fails closed (Azure allows up to 8).
    expect(() =>
      resolveVolumeSignals({
        provider: "aws",
        accountCount: 10,
        enabledLogCategories: 8,
      }),
    ).toThrow(/exceeds aws max/i);
    const azFull = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      enabledLogCategories: 8,
    });
    const azHalf = resolveVolumeSignals({
      provider: "azure",
      accountCount: 10,
      enabledLogCategories: 4,
    });
    expect(azHalf.ingressGBPerDay).toBeCloseTo(azFull.ingressGBPerDay * 0.5);
    expect(LOG_CATEGORY_SETS.azure.categories).not.toBe(
      LOG_CATEGORY_SETS.aws.categories,
    );
  });
});

describe("package 13 — EDGE+", () => {
  it("package 13 — EDGE+ corrupt freeze payload fails closed", () => {
    const loaded = loadFrozenEstimate("{not-json", {
      currentModelVersion: "0.1.0",
    });
    expect(loaded.ok).toBe(false);
  });
});

describe("package 14 — EDGE+", () => {
  it("package 14 — EDGE+ formula checks refuse silent env skip", () => {
    expect(() => assertFormulaChecksNotSkippedByEnv()).not.toThrow();
    expect(FORMULA_CHECKS.length).toBeGreaterThan(0);
    expect(process.env.SKIP_FORMULA_REGRESSION).not.toBe("1");
  });
});

describe("package 16 — EDGE+", () => {
  it("package 16 — EDGE+ missing meter on live-like card is not invented as $0", () => {
    const card: RateCard = {
      provider: "azure",
      region: "eastus",
      currency: "USD",
      unitPrices: {},
      capturedAt: "2026-07-01T00:00:00.000Z",
    };
    expect(lookupUnitPrice(card, "eh-standard-tu")).toBeUndefined();
    expect("eh-standard-tu" in card.unitPrices).toBe(false);
  });
});

describe("package 20 engine — EDGE+", () => {
  it("package 20 — EDGE+ horizon >36 rejected; negative growth floored at 0", () => {
    expect(() =>
      projectCosts({ monthlyExpected: 10, months: 37 }),
    ).toThrow(/36|horizon|months/i);
    const r = projectCosts({
      monthlyExpected: 100,
      months: 2,
      annualGrowthPercent: -50,
    });
    expect(r.series.every((p) => p.expected >= 0)).toBe(true);
  });
});
