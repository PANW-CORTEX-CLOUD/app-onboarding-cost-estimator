/**
 * REQ-6 — an absent input must not silently become zero.
 *
 * The distinction under test: "nobody said how big the estate is" and "the
 * estate is empty" are different statements, and only the second one has $0 as
 * an honest answer. The request layer used to erase that difference with
 * `?? 0` before any estimator could see it.
 */
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_SIZING_DRIVERS,
  assertCapabilitiesAreSized,
  findUnsizedCapabilities,
} from "../capability-drivers.ts";
import { createEstimate } from "../create-estimate.ts";
import { createAzureRatesAdapter } from "../azure/azure-rates-adapter.ts";
import { createAwsRatesAdapter } from "../aws/aws-rates-adapter.ts";
import { createGcpRatesAdapter } from "../gcp/gcp-rates-adapter.ts";
import { createRatesCache } from "../rates/rates-cache.ts";

const NOW = new Date("2026-08-15T00:00:00.000Z");
const OFFLINE_RATES = {
  adapters: {
    azure: createAzureRatesAdapter({ forceFallback: true, now: NOW }),
    aws: createAwsRatesAdapter({ forceFallback: true, now: NOW }),
    gcp: createGcpRatesAdapter({ forceFallback: true, now: NOW }),
  },
  cache: createRatesCache(),
};

describe("absent vs deliberately zero", () => {
  it("no drivers at all is unsized", () => {
    expect(findUnsizedCapabilities(["dspm"], {})).toStrictEqual([
      { capability: "dspm", drivers: ["dataEstateGB"] },
    ]);
  });

  it("EDGE: an explicit zero is a decision, not a gap", () => {
    expect(findUnsizedCapabilities(["dspm"], { dataEstateGB: 0 })).toStrictEqual([]);
    expect(
      findUnsizedCapabilities(["ads_cloud"], { vmCount: 0, avgUsedDiskGB: 0 }),
    ).toStrictEqual([]);
  });

  it("one of several drivers is enough — partial input is allowed", () => {
    // Requiring every driver would reject reasonable input where documented
    // defaults cover the rest.
    expect(
      findUnsizedCapabilities(["ads_cloud"], { vmCount: 12 }),
    ).toStrictEqual([]);
    expect(
      findUnsizedCapabilities(["registry"], { avgImageGB: 0.4 }),
    ).toStrictEqual([]);
  });

  it("capabilities with no sizing of their own are never flagged", () => {
    // discovery has no meter; audit volume derives from accountCount, which
    // always has a documented default; egress falls back to audit ingress.
    expect(CAPABILITY_SIZING_DRIVERS.discovery).toBeUndefined();
    expect(CAPABILITY_SIZING_DRIVERS.audit_logs).toBeUndefined();
    expect(CAPABILITY_SIZING_DRIVERS.egress).toBeUndefined();
    expect(
      findUnsizedCapabilities(["discovery", "audit_logs", "egress"], {}),
    ).toStrictEqual([]);
  });

  it("EDGE: several unsized capabilities are all reported, not just the first", () => {
    const missing = findUnsizedCapabilities(["dspm", "registry", "serverless"], {});
    expect(missing.map((m) => m.capability)).toStrictEqual([
      "dspm",
      "registry",
      "serverless",
    ]);
  });

  it("the error names the capability and the fields that would fix it", () => {
    expect(() => assertCapabilitiesAreSized(["dspm"], {})).toThrow(
      /dspm \(needs one of: data estate GB\)/,
    );
    expect(() => assertCapabilitiesAreSized(["ads_cloud"], {})).toThrow(
      /VM count, average used disk GB/,
    );
    expect(() => assertCapabilitiesAreSized(["dspm"], {})).toThrow(
      /Refusing to report \$0/,
    );
  });

  it("says nothing when everything is sized", () => {
    expect(() =>
      assertCapabilitiesAreSized(["dspm", "registry"], {
        dataEstateGB: 100,
        imageCount: 5,
      }),
    ).not.toThrow();
  });
});

describe("the guard reaches real estimates", () => {
  const base = {
    provider: "azure" as const,
    region: "eastus",
    now: NOW,
    ratesOptions: OFFLINE_RATES,
  };

  it("an enabled capability with no sizing is refused, not quoted at $0", async () => {
    await expect(
      createEstimate({
        ...base,
        capabilities: { auditLogs: true, dspm: true },
        volume: { accountCount: 10 },
      }),
    ).rejects.toThrow(/capability enabled without any sizing input.*dspm/s);
  });

  it("EDGE: an explicit zero estate is priced and warned, not refused", async () => {
    // AWS has no empty-discovery rule, so this exercises the sizing guard on
    // its own: zero was chosen, so $0 is the honest answer.
    const res = await createEstimate({
      provider: "aws",
      region: "us-east-1",
      now: NOW,
      ratesOptions: OFFLINE_RATES,
      capabilities: { dspm: true },
      volume: { accountCount: 10, dataEstateGB: 0 },
    });
    expect(res.totals.expected).toBe(0);
    expect(res.warnings.join(" ")).toMatch(/dataEstateGB=0/);
  });

  it("EDGE: Azure is stricter — empty discovery TF refuses even an explicit zero", async () => {
    // Two fail-closed rules compose here, and the stricter one wins. Azure's
    // DISCOVERY-assets_discovery.tf is empty, so the connector has no telemetry
    // to corroborate an estate size; a self-reported zero is not enough to
    // quote against. This is deliberate and predates the sizing guard.
    await expect(
      createEstimate({
        ...base,
        capabilities: { dspm: true },
        volume: { accountCount: 10, dataEstateGB: 0 },
      }),
    ).rejects.toThrow(/empty discovery TF .* refuse silent precision/);
  });

  it("audit-only never trips the guard", async () => {
    const res = await createEstimate({
      ...base,
      capabilities: { auditLogs: true },
      volume: { accountCount: 10 },
    });
    expect(res.lineItems.length).toBeGreaterThan(0);
  });

  it("EDGE: as-deployed drops the capability first, so it cannot be refused for sizing", async () => {
    // The Terraform does not deploy DSPM, so in as-deployed mode it is removed
    // before the sizing guard runs — refusing there would be nonsense, since
    // the capability is not going to be billed at all.
    const res = await createEstimate({
      ...base,
      capabilities: { auditLogs: true, dspm: true },
      volume: { accountCount: 10 },
      tfMode: "as-deployed",
    });
    expect(res.excludedCapabilities.map((e) => e.capability)).toContain("dspm");
    expect(res.lineItems.every((l) => l.capability !== "dspm")).toBe(true);
  });
});

describe("T-5.1.2 — estimates report what they guessed", () => {
  it("an audit-only estimate reports the defaults it leaned on", async () => {
    const res = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: {},
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    const fields = res.appliedDefaults.map((d) => d.field);
    expect(fields).toContain("monthHours");
    expect(fields).toContain("volume.accountCount");
    for (const d of res.appliedDefaults) {
      expect(d.rationale.length, d.field).toBeGreaterThan(20);
      expect(["convention", "assumption"]).toContain(d.kind);
    }
  });

  it("supplying a value removes it from the guess list", async () => {
    const res = await createEstimate({
      provider: "azure",
      region: "eastus",
      capabilities: { auditLogs: true },
      volume: { accountCount: 250 },
      monthHours: 744,
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    const fields = res.appliedDefaults.map((d) => d.field);
    expect(fields).not.toContain("volume.accountCount");
    expect(fields).not.toContain("monthHours");
  });

  it("EDGE: turning on DSPM adds its own guesses, and supplying them removes them", async () => {
    const guessed = await createEstimate({
      provider: "aws",
      region: "us-east-1",
      capabilities: { dspm: true },
      volume: { dataEstateGB: 1024 },
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    expect(guessed.appliedDefaults.map((d) => d.field)).toContain(
      "volume.avgObjectSizeMB",
    );

    const supplied = await createEstimate({
      provider: "aws",
      region: "us-east-1",
      capabilities: { dspm: true },
      volume: { dataEstateGB: 1024, avgObjectSizeMB: 16, pctScanned: 50 },
      now: NOW,
      ratesOptions: OFFLINE_RATES,
    });
    const fields = supplied.appliedDefaults.map((d) => d.field);
    expect(fields).not.toContain("volume.avgObjectSizeMB");
    expect(fields).not.toContain("volume.pctScanned");
  });
});
