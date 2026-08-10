/**
 * Package 03 — monorepo layout REQ/AC/TEST/EDGE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { modelVersion } from "../model-version.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "../..");

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

describe("package 03 — REQ layout", () => {
  it("workspace packages, openapi, sources, docker-compose exist", () => {
    const r = runNode("scripts/check-monorepo-layout.mjs");
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it("public exports via index.ts only expose modelVersion + ports", () => {
    const index = fs.readFileSync(
      path.join(PACKAGE_ROOT, "src/index.ts"),
      "utf8",
    );
    expect(index).toMatch(/export \{ modelVersion \}/);
    expect(index).toMatch(/ProviderEstimator/);
    expect(index).not.toMatch(/from ["']react["']/);
  });
});

describe("package 03 — AC", () => {
  it("modelVersion exported from engine root", () => {
    expect(modelVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("web depends on generated OpenAPI types, not api source", () => {
    const webPkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "apps/web/package.json"), "utf8"),
    );
    const deps = {
      ...(webPkg.dependencies ?? {}),
      ...(webPkg.devDependencies ?? {}),
    };
    expect(deps["@cloud-connector/api"]).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "apps/web/src/shared/api/generated/openapi.types.ts",
        ),
      ),
    ).toBe(true);
  });

  it("engine unit tests run without starting HTTP (no listen in engine src)", () => {
    const engineSrc = path.join(PACKAGE_ROOT, "src");
    const hits = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name.includes("fixture")) continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.ts$/.test(ent.name) && !ent.name.includes(".test.")) {
          const t = fs.readFileSync(p, "utf8");
          if (/\.listen\s*\(/.test(t) || /createServer\s*\(/.test(t)) {
            hits.push(path.relative(engineSrc, p));
          }
        }
      }
    };
    walk(engineSrc);
    expect(hits, hits.join(", ")).toEqual([]);
  });

  it("build order scripts: engine → api → web", () => {
    const root = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    expect(root.scripts.build).toMatch(
      /cost-engine.*@cloud-connector\/api.*@cloud-connector\/web/,
    );
  });
});

describe("package 03 — TEST", () => {
  it("cost-engine package.json exports field is present and resolvable", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    );
    expect(pkg.exports["."]).toBeTruthy();
    const entry =
      typeof pkg.exports["."] === "string"
        ? pkg.exports["."]
        : pkg.exports["."].import || pkg.exports["."].default;
    expect(fs.existsSync(path.join(PACKAGE_ROOT, entry))).toBe(true);
  });

  it("vitest projects include core through egress + monorepo", () => {
    const cfg = fs.readFileSync(
      path.join(PACKAGE_ROOT, "vitest.config.ts"),
      "utf8",
    );
    for (const name of [
      "core",
      "azure",
      "aws",
      "gcp",
      "rates",
      "streams",
      "storage",
      "ads",
      "dspm",
      "registry-serverless",
      "egress",
      "monorepo",
    ]) {
      expect(cfg).toContain(`name: "${name}"`);
    }
  });

  it("engine package.json has no UI runtime", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    );
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };
    expect(deps.react).toBeUndefined();
    expect(deps.hono).toBeUndefined();
    expect(deps.vite).toBeUndefined();
  });

  it("boundary lint exits 0", () => {
    const r = runNode("scripts/check-boundaries.mjs");
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });
});

describe("package 03 — EDGE", () => {
  it("circular deps check exits 0", () => {
    const r = runNode("scripts/check-circular-deps.mjs");
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it("openapi drift check exits 0", () => {
    const r = runNode("scripts/check-openapi-drift.mjs");
    expect(r.status, r.stderr || r.stdout).toBe(0);
  });

  it("deep cross-package relative import fails boundary lint", () => {
    const fixtureDir = path.join(PACKAGE_ROOT, "src/__boundary_fixture_deep__");
    fs.mkdirSync(fixtureDir, { recursive: true });
    const fixture = path.join(fixtureDir, "bad-deep.ts");
    // Build import via JSON.stringify so this test source does not trip the linter.
    const relSpec = ["..", "..", "..", "..", "apps", "web", "package.json"].join(
      "/",
    );
    fs.writeFileSync(
      fixture,
      `import x from ${JSON.stringify(relSpec)};\nexport default x;\n`,
    );
    const r = runNode("scripts/check-boundaries.mjs");
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/no-deep-cross-package-relative/);
  });

  it("no nested cost-estimator/ repo", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "cost-estimator"))).toBe(false);
  });
});
