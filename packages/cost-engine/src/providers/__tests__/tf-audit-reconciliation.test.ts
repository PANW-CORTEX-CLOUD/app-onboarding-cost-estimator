/**
 * Package 30 — TF↔meter↔retail reconciliation matrix tests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AZURE_TF_AUDIT_BILLABLE_METERS,
  AZURE_AUDIT_ONLY_METER_ALLOWLIST,
  AZURE_TF_EXCLUDED_FROM_METERS,
  assertAzureAuditMapMatchesReconciliation,
  azureAuditMapMeterIds,
  isAzureAuditOnlyMeterAllowed,
} from "../azure/tf-audit-reconciliation.ts";
import { AZURE_TF_DEFAULTS } from "../azure/capability-meter-map.ts";
import { createEstimate } from "../create-estimate.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");

const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const RECON_DOC = path.join(REPO_ROOT, "docs/TF_COST_RECONCILIATION.md");

/**
 * Price from the in-repo fallback, never the live feed. Without this seam the
 * discovery-only estimate below reaches the real Azure Retail Prices API — a
 * feed it will not even use, since discovery has no meter — and the test turns
 * into a network test that times out on a slow or contended link (which is
 * exactly how it failed in the full parallel suite while passing in isolation).
 * Two sessions added this seam independently; the merged copy keeps the pinned
 * clock so rate-provenance ages stay deterministic too.
 */
const NOW = new Date("2026-08-11T00:00:00.000Z");
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  },
  cache: createRatesCache(),
};

describe("package 30 — TF reconciliation matrix (REQ/AC)", () => {
  it("reconciliation doc lists discovery $0, three audit meters, exclusions", () => {
    const doc = fs.readFileSync(RECON_DOC, "utf8");
    expect(doc).toMatch(/DISCOVERY-assets_discovery\.tf/);
    expect(doc).toMatch(/\$0/);
    for (const id of AZURE_TF_AUDIT_BILLABLE_METERS) {
      expect(doc).toContain(id);
    }
    expect(doc).toMatch(/partition/i);
    expect(doc).toMatch(/Capture/);
    expect(doc).toMatch(/authorization_rule|auth/i);
    expect(doc).toMatch(/consumer_group/i);
    expect(doc).toMatch(/resource_group/i);
    expect(doc).toMatch(/diagnostic/i);
  });

  it("audit map meterIds match reconciliation billable allowlist", () => {
    assertAzureAuditMapMatchesReconciliation();
    expect(new Set(azureAuditMapMeterIds())).toEqual(
      new Set(AZURE_TF_AUDIT_BILLABLE_METERS),
    );
  });

  it("discovery-only estimate is $0 with no line items", async () => {
    const r = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { discovery: true },
      volume: { accountCount: 10 },
      ratesOptions: OFFLINE_RATES,
      now: NOW,
    });
    expect(r.lineItems).toEqual([]);
    expect(r.totals.expected).toBe(0);
  });
});

describe("package 30 — EDGE excluded TF resources invent no meters", () => {
  it("excluded list covers auth, consumer group, RG, diagnostics, Capture, partitions", () => {
    const resources = AZURE_TF_EXCLUDED_FROM_METERS.map((e) => e.resource);
    expect(resources.some((r) => /authorization_rule/i.test(r))).toBe(true);
    expect(resources.some((r) => /consumer_group/i.test(r))).toBe(true);
    expect(resources.some((r) => /resource_group/i.test(r))).toBe(true);
    expect(resources.some((r) => /diagnostic/i.test(r))).toBe(true);
    expect(resources.some((r) => /Capture/i.test(r))).toBe(true);
    expect(resources.some((r) => /partition/i.test(r))).toBe(true);
    expect(AZURE_TF_DEFAULTS.captureConfigured).toBe(false);
  });

  it("forbidden / invented meter ids are not on the audit allowlist", () => {
    for (const bad of [
      "eh-standard-capture",
      "eh-partition-hour",
      "auth-rule",
      "consumer-group",
      "resource-group",
      "diagnostic-setting",
    ]) {
      expect(isAzureAuditOnlyMeterAllowed(bad)).toBe(false);
    }
    for (const ok of AZURE_AUDIT_ONLY_METER_ALLOWLIST) {
      expect(isAzureAuditOnlyMeterAllowed(ok)).toBe(true);
    }
  });
});
