/**
 * API integration: estimate CLI golden body via createApp (OpenAPI path).
 * Proves CLI fixture numbers match POST /v1/estimates without a listen() socket.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../app.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../..");

// Load plain ESM check helpers (same module the CLI uses).
const checkPath = path.join(ROOT, "scripts/lib/estimate-check.mjs");
const {
  AZURE_AUDIT_GOLDEN_REQUEST,
  DISCOVERY_ONLY_REQUEST,
  assertAzureAuditGolden,
  assertDiscoveryOnlyZero,
} = await import(checkPath);

describe("estimate CLI golden via API", () => {
  it("POST /v1/estimates azure audit golden passes assertAzureAuditGolden", async () => {
    const app = createApp();
    const ratesRes = await app.request(
      `/v1/rates?provider=azure&region=${AZURE_AUDIT_GOLDEN_REQUEST.region}`,
    );
    expect(ratesRes.status).toBe(200);
    const rates = await ratesRes.json();

    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(AZURE_AUDIT_GOLDEN_REQUEST),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    const result = assertAzureAuditGolden(body, {
      unitPrices: rates.unitPrices,
      ratesSource: rates.ratesSource,
    });
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("POST /v1/estimates discovery-only is $0", async () => {
    const app = createApp();
    const res = await app.request("/v1/estimates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(DISCOVERY_ONLY_REQUEST),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const result = assertDiscoveryOnlyZero(body);
    expect(result.ok, result.errors.join("; ")).toBe(true);
  });

  it("CLI script and check module exist (layout)", () => {
    expect(
      readFileSync(path.join(ROOT, "scripts/estimate.mjs"), "utf8"),
    ).toMatch(/POST \/v1\/estimates/);
    expect(
      readFileSync(path.join(ROOT, "scripts/lib/estimate-check.mjs"), "utf8"),
    ).toMatch(/AZURE_AUDIT_GOLDEN_REQUEST/);
  });
});
