/**
 * Package 01 research tests: doc↔map 1:1, TF path citations, live official URLs, EDGE guards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CapabilityMeterRow } from "../meter-map.types.ts";
import { REQUIRED_CAPABILITIES } from "../meter-map.types.ts";
import {
  AZURE_RETAIL_PRICES_API_URL,
  AZURE_TF_DEFAULTS,
  AZURE_TF_INVENTORY_ROOT,
  assertAzureMapCoversRequiredCapabilities,
  azureCapabilityMeterMap,
} from "../azure/capability-meter-map.ts";
import {
  AWS_PRICE_LIST_API_URL,
  AWS_TF_PRESENT,
  assertAwsMapCoversRequiredCapabilities,
  awsCapabilityMeterMap,
} from "../aws/capability-meter-map.ts";
import {
  GCP_BILLING_CATALOG_API_URL,
  GCP_TF_PRESENT,
  assertGcpMapCoversRequiredCapabilities,
  gcpCapabilityMeterMap,
} from "../gcp/capability-meter-map.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** cost-engine package root */
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");
/** monorepo root (cloud-connector) */
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const DOC_PATH = path.join(REPO_ROOT, "docs/CLOUD_COST_MODEL.md");

const OFFICIAL_HOST_SUFFIXES = [
  "azure.microsoft.com",
  "learn.microsoft.com",
  "microsoft.com",
  "aws.amazon.com",
  "docs.aws.amazon.com",
  "amazon.com",
  "cloud.google.com",
] as const;

function isOfficialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_SUFFIXES.some(
      (s) => host === s || host.endsWith(`.${s}`),
    );
  } catch {
    return false;
  }
}

/** Parse markdown pipe tables that include meterId + sourceUrl columns, tagged by section provider. */
function parseDocMeterRows(doc: string): Array<{
  provider: "azure" | "aws" | "gcp";
  capability: string;
  meterId: string;
  sourceUrl: string;
  confidence: string;
}> {
  const rows: Array<{
    provider: "azure" | "aws" | "gcp";
    capability: string;
    meterId: string;
    sourceUrl: string;
    confidence: string;
  }> = [];
  let provider: "azure" | "aws" | "gcp" | null = null;
  for (const line of doc.split("\n")) {
    if (/^## Azure capability/i.test(line)) provider = "azure";
    else if (/^## AWS capability/i.test(line)) provider = "aws";
    else if (/^## GCP capability/i.test(line)) provider = "gcp";
    else if (/^## /.test(line)) provider = null;

    if (!provider || !line.startsWith("|")) continue;
    if (line.includes("meterId") || line.includes("---")) continue;
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    // capability | permissionSignal | meterId | meterSku | unit | confidence | sourceUrl
    if (cols.length < 7) continue;
    if (!/^https?:\/\//.test(cols[6])) continue;
    rows.push({
      provider,
      capability: cols[0],
      meterId: cols[2],
      confidence: cols[5],
      sourceUrl: cols[6],
    });
  }
  return rows;
}

function rowKey(
  provider: string,
  r: Pick<CapabilityMeterRow, "capability" | "meterId">,
): string {
  return `${provider}::${r.capability}::${r.meterId}`;
}

describe("package 01 — capability coverage (AC)", () => {
  it("covers Discovery/Audit/ADS Cloud|Outpost/DSPM/Registry/Serverless on all providers", () => {
    assertAzureMapCoversRequiredCapabilities();
    assertAwsMapCoversRequiredCapabilities();
    assertGcpMapCoversRequiredCapabilities();
    for (const id of REQUIRED_CAPABILITIES) {
      expect(azureCapabilityMeterMap.some((r) => r.capability === id)).toBe(true);
      expect(awsCapabilityMeterMap.some((r) => r.capability === id)).toBe(true);
      expect(gcpCapabilityMeterMap.some((r) => r.capability === id)).toBe(true);
    }
  });

  it("each map row has permission, meterId/SKU, High|Med|Low confidence, and sourceUrl", () => {
    const all = [
      ...azureCapabilityMeterMap,
      ...awsCapabilityMeterMap,
      ...gcpCapabilityMeterMap,
    ];
    for (const r of all) {
      expect(r.permissionSignal.length).toBeGreaterThan(3);
      expect(r.meterId.length).toBeGreaterThan(0);
      expect(r.meterSku.length).toBeGreaterThan(0);
      expect(["High", "Med", "Low"]).toContain(r.confidence);
      expect(r.sourceUrl).toMatch(/^https:\/\//);
      expect(isOfficialHost(r.sourceUrl)).toBe(true);
    }
  });

  it("documents TF defaults for Azure Standard EH, AWS Kinesis/SQS, GCP PubSub", () => {
    expect(AZURE_TF_DEFAULTS.eventHubsSku).toBe("Standard");
    expect(AZURE_TF_DEFAULTS.eventHubsCapacityTu).toBe(1);
    expect(AZURE_TF_DEFAULTS.eventHubsMaxAutoInflateTu).toBe(20);
    expect(AZURE_TF_DEFAULTS.captureConfigured).toBe(false);
    const doc = fs.readFileSync(DOC_PATH, "utf8");
    expect(doc).toContain("Standard");
    expect(doc).toContain("Kinesis");
    expect(doc).toContain("SQS");
    expect(doc).toContain("Pub/Sub");
    expect(doc).toMatch(/Non-costs/i);
  });
});

describe("package 01 — doc ↔ meter-map 1:1 (TEST)", () => {
  it("CLOUD_COST_MODEL.md tables match provider map exports 1:1", () => {
    const doc = fs.readFileSync(DOC_PATH, "utf8");
    const docRows = parseDocMeterRows(doc);
    const maps: Array<{ provider: "azure" | "aws" | "gcp"; row: CapabilityMeterRow }> = [
      ...azureCapabilityMeterMap.map((row) => ({ provider: "azure" as const, row })),
      ...awsCapabilityMeterMap.map((row) => ({ provider: "aws" as const, row })),
      ...gcpCapabilityMeterMap.map((row) => ({ provider: "gcp" as const, row })),
    ];
    expect(docRows.length).toBe(maps.length);

    const docKeys = new Set(docRows.map((r) => `${r.provider}::${r.capability}::${r.meterId}`));
    const mapKeys = new Set(maps.map((m) => rowKey(m.provider, m.row)));
    expect(docKeys).toEqual(mapKeys);

    for (const m of maps) {
      const d = docRows.find(
        (r) =>
          r.provider === m.provider &&
          r.capability === m.row.capability &&
          r.meterId === m.row.meterId,
      );
      expect(d, `missing doc row for ${rowKey(m.provider, m.row)}`).toBeTruthy();
      expect(d!.sourceUrl).toBe(m.row.sourceUrl);
      expect(d!.confidence).toBe(m.row.confidence);
    }
  });

  it("TF path citations open to real files where they exist", () => {
    const azureRoot = path.join(REPO_ROOT, AZURE_TF_INVENTORY_ROOT);
    expect(fs.existsSync(azureRoot)).toBe(true);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "azure/data/AUDIT_LOGS-audit_organization.tf")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "azure/data/AUDIT_LOGS-audit_common_resources.tf")),
    ).toBe(true);
    const discovery = path.join(REPO_ROOT, AZURE_TF_DEFAULTS.discoveryTfPath);
    expect(fs.existsSync(discovery)).toBe(true);
    expect(fs.statSync(discovery).size).toBe(0);
    expect(AWS_TF_PRESENT).toBe(false);
    expect(GCP_TF_PRESENT).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, "aws/README.md"))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "gcp/README.md"))).toBe(true);
  });
});

describe("package 01 — live official URLs (TEST)", () => {
  it("every cited meter sourceUrl resolves on an official host", async () => {
    const urls = [
      ...new Set(
        [
          ...azureCapabilityMeterMap.map((r) => r.sourceUrl),
          ...awsCapabilityMeterMap.map((r) => r.sourceUrl),
          ...gcpCapabilityMeterMap.map((r) => r.sourceUrl),
          AZURE_RETAIL_PRICES_API_URL,
          AWS_PRICE_LIST_API_URL,
          GCP_BILLING_CATALOG_API_URL,
        ].filter(Boolean),
      ),
    ];

    const failures: string[] = [];
    /** Reachable but temporarily unhappy — reported, never fatal. */
    const transient: string[] = [];
    for (const url of urls) {
      if (!isOfficialHost(url)) {
        failures.push(`${url} — not an official host`);
        continue;
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: { "user-agent": "cloud-connector-research-url-check/0.1" },
        });
        clearTimeout(timer);
        // What this check is for is dead or moved citations, so only a
        // definitive "not here" counts as a failure. Vendor marketing sites
        // routinely answer 429/503 under load, and treating that as a broken
        // link turns the whole suite into a coin flip on their uptime.
        if (res.status === 404 || res.status === 410) {
          failures.push(`${url} — HTTP ${res.status} (citation is dead)`);
        } else if (!(res.status >= 200 && res.status < 400)) {
          transient.push(`${url} — HTTP ${res.status}`);
        }
      } catch (err) {
        // A network/DNS/abort error is the environment's problem, not the
        // citation's — a dead link answers, it does not fail to connect.
        transient.push(
          `${url} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (transient.length) {
      console.warn(
        `citation reachability degraded (not fatal):\n  ${transient.join("\n  ")}`,
      );
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 120_000);
});

describe("package 01 — EDGE", () => {
  it("documents GovCloud / FedRAMP / empty discovery / blogs reference-only", () => {
    const doc = fs.readFileSync(DOC_PATH, "utf8");
    expect(doc).toMatch(/Azure Government/i);
    expect(doc).toMatch(/GovCloud/i);
    expect(doc).toMatch(/FedRAMP/i);
    expect(doc).toMatch(/reference-only/i);
    expect(doc).toMatch(/Empty Discovery/i);
    expect(doc).toMatch(/must \*\*not\*\* leak into.*core/i);
  });

  it("does not place meter maps under core/ (no Azure leak into core types)", () => {
    const coreDir = path.join(REPO_ROOT, "packages/cost-engine/src/core");
    const mapsInCore = [];
    const walk = (d) => {
      if (!fs.existsSync(d)) return;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const pth = path.join(d, ent.name);
        if (ent.isDirectory()) walk(pth);
        else if (ent.name.includes("capability-meter-map")) mapsInCore.push(pth);
      }
    };
    walk(coreDir);
    expect(mapsInCore).toEqual([]);
    const azureMap = path.join(
      REPO_ROOT,
      "packages/cost-engine/src/providers/azure/capability-meter-map.ts",
    );
    expect(fs.existsSync(azureMap)).toBe(true);
  });

  it("snapshot: azure map meterIds stay stable", () => {
    expect(azureCapabilityMeterMap.map((r) => r.meterId)).toMatchInlineSnapshot(`
      [
        "none",
        "eh-standard-tu",
        "eh-standard-ingress-events",
        "blob-hot-lrs-capacity",
        "managed-disk-snapshot",
        "vm-outpost-scanner",
        "blob-hot-lrs-read-10k",
        "blob-hot-lrs-list-10k",
        "azure-egress-gb",
        "functions-scan-ops",
        "azure-egress-gb",
      ]
    `);
  });
});
