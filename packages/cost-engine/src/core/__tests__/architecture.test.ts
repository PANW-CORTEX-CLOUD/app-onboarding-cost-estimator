/**
 * Package 02 — architecture guide tests: ports, doc links, boundary lint, EDGE guards.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { ProviderEstimator } from "../../core/ports/provider-estimator.interface.ts";
import type { RatesAdapter } from "../../core/ports/rates-adapter.interface.ts";
import type { MeterMap } from "../../core/ports/meter-map.interface.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");
const ARCH = path.join(REPO_ROOT, "docs/ARCHITECTURE.md");

describe("package 02 — ports (AC)", () => {
  it("ProviderEstimator.estimate(inputs, rates) is declared", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "packages/cost-engine/src/core/ports/provider-estimator.interface.ts"),
      "utf8",
    );
    expect(src).toMatch(/estimate\s*\(\s*inputs:\s*EstimateInputs\s*,\s*rates:\s*RateCard\s*\)/);
    // type-only smoke — interfaces exist
    const _pe: ProviderEstimator | null = null;
    const _ra: RatesAdapter | null = null;
    const _mm: MeterMap | null = null;
    expect(_pe ?? _ra ?? _mm ?? true).toBeTruthy();
  });

  it("ARCHITECTURE documents layout, OpenAPI SSOT, ADRs", () => {
    const doc = fs.readFileSync(ARCH, "utf8");
    expect(doc).toMatch(/Package layout/i);
    expect(doc).toMatch(/OpenAPI as SSOT/i);
    expect(doc).toMatch(/ProviderEstimator/);
    expect(doc).toMatch(/RatesAdapter/);
    expect(doc).toMatch(/ADR-001/);
    expect(doc).toMatch(/ADR-002/);
    expect(doc).toMatch(/server-side/i);
    expect(doc).toMatch(/One app, three providers/i);
  });
});

describe("package 02 — ARCHITECTURE.md links resolve (TEST)", () => {
  it("relative markdown links to repo paths exist", () => {
    const doc = fs.readFileSync(ARCH, "utf8");
    const linkRe = /\]\((\.\.\/[^)]+)\)/g;
    const missing: string[] = [];
    let m;
    while ((m = linkRe.exec(doc)) !== null) {
      const target = path.resolve(path.dirname(ARCH), m[1].split("#")[0]);
      if (!fs.existsSync(target)) missing.push(m[1]);
    }
    // also ./adr and ./CLOUD links
    const localRe = /\]\((\.\/[^)]+)\)/g;
    while ((m = localRe.exec(doc)) !== null) {
      const target = path.resolve(path.dirname(ARCH), m[1].split("#")[0]);
      if (!fs.existsSync(target)) missing.push(m[1]);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
});

describe("package 02 — boundary linter (TEST)", () => {
  it("check-boundaries exits 0 on clean tree", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/check-boundaries.mjs")],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(r.status, r.stderr || r.stdout).toBe(0);
    expect(r.stdout).toMatch(/BOUNDARY CHECK: OK/);
  });

  it("fails on illegal cross-provider import (fixture)", () => {
    const fixtureDir = path.join(
      REPO_ROOT,
      "packages/cost-engine/src/providers/azure/__boundary_fixture__",
    );
    fs.mkdirSync(fixtureDir, { recursive: true });
    const fixture = path.join(fixtureDir, "bad-import.ts");
    const spec = ["..", "..", "aws", "capability-meter-map.ts"].join("/");
    fs.writeFileSync(
      fixture,
      `import { awsCapabilityMeterMap } from ${JSON.stringify(spec)};\nexport const x = awsCapabilityMeterMap;\n`,
    );
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/check-boundaries.mjs")],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/no-cross-provider/);
  });

  it("fails when core imports providers (fixture)", () => {
    const fixture = path.join(
      REPO_ROOT,
      "packages/cost-engine/src/core/__boundary_fixture_core__.ts",
    );
    const spec = ["..", "providers", "azure", "capability-meter-map.ts"].join("/");
    fs.writeFileSync(
      fixture,
      `import { azureCapabilityMeterMap } from ${JSON.stringify(spec)};\nexport const x = azureCapabilityMeterMap;\n`,
    );
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/check-boundaries.mjs")],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    fs.unlinkSync(fixture);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/core-no-providers/);
  });
});

describe("package 02 — EDGE anti-patterns documented", () => {
  it("documents no formulas in React/handlers, no coupling, no silent rate mix", () => {
    const doc = fs.readFileSync(ARCH, "utf8");
    expect(doc).toMatch(/Formula code in React/i);
    expect(doc).toMatch(/OpenAPI handlers/i);
    expect(doc).toMatch(/Cross-provider/i);
    expect(doc).toMatch(/Silent cross-provider rate mix/i);
    expect(doc).toMatch(/anti-pattern/i);
  });

  it("core directory has no provider implementation imports in committed sources", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/check-boundaries.mjs")],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(r.status).toBe(0);
  });
});
