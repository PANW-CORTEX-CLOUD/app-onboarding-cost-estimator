/**
 * Package 22+23 — disclaimer/tagging + calibration CSV tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESTIMATE_DISCLAIMER } from "../shared/model/disclaimer.ts";
import { TAGGING_GUIDANCE } from "../widgets/TaggingGuidance/TaggingGuidance.tsx";
import {
  buildEstimateExport,
  exportToCsv,
  exportToJson,
} from "../features/export-estimate/buildExport.ts";
import {
  parseBillingCsv,
  scaleVolumeFields,
  suggestCalibrationFactor,
  LIST_VS_ACTUAL_NOTE,
} from "../features/calibration/billingCsv.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, "../features/calibration/__fixtures__");

const estimate = {
  provider: "azure" as const,
  lineItems: [
    {
      provider: "azure" as const,
      capability: "auditLogs",
      meterId: "eh-standard-tu",
      amount: 10,
      confidence: "Med" as const,
    },
  ],
  totals: { expected: 10 },
  confidence: "Med" as const,
  modelVersion: "0.1.0",
  ratesAsOf: "2026-07-01T00:00:00.000Z",
  inputHash: "abc",
};

describe("package 22 — disclaimer & tags", () => {
  it("export fixtures assert disclaimer string", () => {
    const payload = buildEstimateExport(estimate);
    expect(payload.disclaimer).toBe(ESTIMATE_DISCLAIMER);
    expect(exportToJson(payload)).toContain("Indicative customer-cloud");
    expect(exportToCsv(payload)).toContain("disclaimer");
  });

  it("tagging guidance covers azure/aws/gcp patterns", () => {
    expect(TAGGING_GUIDANCE.azure.patterns.join(" ")).toMatch(/cortex-onboarding/);
    expect(TAGGING_GUIDANCE.azure.patterns.join(" ")).toMatch(/managed_by=paloaltonetworks/);
    expect(TAGGING_GUIDANCE.aws.patterns.join(" ")).toMatch(/ManagedBy|managed_by/i);
    expect(TAGGING_GUIDANCE.gcp.patterns.join(" ")).toMatch(/managed_by=paloaltonetworks/);
    expect(TAGGING_GUIDANCE.azure.tfCite).toMatch(/azure\/data/);
    expect(TAGGING_GUIDANCE.azure.tfCite).toMatch(/docs\/TAGGING\.md/);
  });

  it("disclaimer a11y landmark is an aside", () => {
    // Structural contract — widget uses <aside aria-label="Disclaimer">
    const src = readFileSync(
      path.resolve(__dirname, "../widgets/Disclaimer/Disclaimer.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<aside aria-label="Disclaimer"/);
    expect(src).toMatch(/session only/i);
    expect(src).toMatch(/English baseline/);
  });
});

describe("package 23 — calibration CSV", () => {
  it("parses Azure/AWS/GCP fixture CSVs", () => {
    for (const [file, provider] of [
      ["azure-billing.csv", "azure"],
      ["aws-billing.csv", "aws"],
      ["gcp-billing.csv", "gcp"],
    ] as const) {
      const text = readFileSync(path.join(FIX, file), "utf8");
      const parsed = parseBillingCsv(text);
      expect("ok" in parsed && parsed.ok === false).toBe(false);
      const ok = parsed as Exclude<typeof parsed, { ok: false }>;
      expect(ok.provider).toBe(provider);
      expect(ok.totalActual).toBeGreaterThan(0);
      expect(ok.unmatched.length).toBeGreaterThan(0);
      expect(ok.warnings.join(" ")).toContain("List/Retail");
    }
  });

  it("apply 1.5× updates volume lines not unit prices", () => {
    const vol = { accountCount: 10, ingressGBPerDay: 20, peakMBps: 2 };
    const next = scaleVolumeFields(vol, 1.5);
    expect(next.accountCount).toBe(15);
    expect(next.ingressGBPerDay).toBe(30);
    expect(next.peakMBps).toBe(3);
    expect(suggestCalibrationFactor(100, 150)).toBeCloseTo(1.5);
  });

  it("invalid CSV / mixed currency / huge file fail closed", () => {
    expect(parseBillingCsv("not,a,billing\n1,2,3")).toMatchObject({ ok: false });
    const mixed = "MeterCategory,CostInBillingCurrency,Currency\nEH,1,USD\nS3,2,EUR\n";
    const m = parseBillingCsv(mixed);
    expect("ok" in m && m.ok === false).toBe(true);
    const huge = "a,b\n" + "x,1\n".repeat(200_000);
    const h = parseBillingCsv(huge, { maxBytes: 1000 });
    expect(h).toMatchObject({ ok: false });
  });

  it("exposes List vs Actual note", () => {
    expect(LIST_VS_ACTUAL_NOTE).toMatch(/EA|Savings Plans|CUD/i);
  });
});
