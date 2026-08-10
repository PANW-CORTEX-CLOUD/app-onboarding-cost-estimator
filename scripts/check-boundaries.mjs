#!/usr/bin/env node
/**
 * check-boundaries.mjs — Fail-closed import boundary linter for cloud-connector.
 *
 * Forbidden:
 * - apps/web → packages/api source or cost-engine deep internals
 * - apps/web FSD cross-layer (lower must not import upper):
 *   app → pages → widgets → features → entities → shared
 * - cost-engine → react / hono
 * - cost-engine/core → providers/*
 * - cross-provider imports azure ↔ aws ↔ gcp
 * - packages/api implementing formulas via deep provider imports is OK for adapters,
 *   but web must not import engine providers
 *
 * Usage: node scripts/check-boundaries.mjs [--root DIR]
 * Exit 0 = clean; 1 = violations (fail closed).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv.includes("--root")
  ? process.argv[process.argv.indexOf("--root") + 1]
  : path.join(__dirname, ".."));

const SRC_GLOBS = [
  "packages/cost-engine/src",
  "packages/api/src",
  "apps/web/src",
];

/** @type {{ file: string, line: number, rule: string, importPath: string }[]} */
const violations = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
      if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(ent.name)) continue;
      out.push(p);
    }
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

function checkFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const rfile = rel(file);
  const lines = text.split("\n");
  const importRe =
    /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    importRe.lastIndex = 0;
    let m;
    while ((m = importRe.exec(line)) !== null) {
      const spec = m[1];
      lintImport(rfile, i + 1, spec);
    }
  }
}

function lintImport(file, line, spec) {
  // cost-engine must not depend on react/hono
  if (file.startsWith("packages/cost-engine/")) {
    if (
      spec === "react" ||
      spec.startsWith("react/") ||
      spec === "hono" ||
      spec.startsWith("hono/")
    ) {
      violations.push({
        file,
        line,
        rule: "engine-no-ui-runtime",
        importPath: spec,
      });
    }
  }

  // core must not import providers
  if (file.includes("/cost-engine/src/core/")) {
    if (
      spec.includes("/providers/") ||
      spec.includes("../providers") ||
      spec.includes("../../providers")
    ) {
      violations.push({
        file,
        line,
        rule: "core-no-providers",
        importPath: spec,
      });
    }
  }

  // cross-provider
  const providerOf = (f) => {
    const m = f.match(/providers\/(azure|aws|gcp)\//);
    return m ? m[1] : null;
  };
  const fromProv = providerOf(file);
  if (fromProv) {
    for (const other of ["azure", "aws", "gcp"]) {
      if (other === fromProv) continue;
      if (
        spec.includes(`/providers/${other}/`) ||
        spec.includes(`providers/${other}`) ||
        new RegExp(`\\.\\./${other}/`).test(spec)
      ) {
        violations.push({
          file,
          line,
          rule: "no-cross-provider",
          importPath: spec,
        });
      }
    }
  }

  // web must not import api implementation or engine internals
  if (file.startsWith("apps/web/")) {
    if (
      spec.includes("packages/api") ||
      spec.includes("@cloud-connector/api") ||
      /cost-engine\/src\/(providers|core)\//.test(spec) ||
      spec.includes("/providers/azure/") ||
      spec.includes("/providers/aws/") ||
      spec.includes("/providers/gcp/")
    ) {
      violations.push({
        file,
        line,
        rule: "web-no-engine-internals-or-api-src",
        importPath: spec,
      });
    }
  }

  // deep relative imports that escape into another package directory
  if (spec.startsWith(".")) {
    const abs = path.resolve(path.dirname(path.join(ROOT, file)), spec);
    const rAbs = rel(abs);
    const pkgOf = (f) => {
      const m = f.match(/^(packages\/[^/]+|apps\/[^/]+)\//);
      return m ? m[1] : null;
    };
    const fromPkg = pkgOf(file);
    const toPkg = pkgOf(rAbs + "/");
    if (fromPkg && toPkg && fromPkg !== toPkg) {
      violations.push({
        file,
        line,
        rule: "no-deep-cross-package-relative",
        importPath: spec,
      });
    }
    // also ban explicit ../../packages/ or ../../apps/ style escapes
    if (
      /(?:\.\.\/)+packages\//.test(spec) ||
      /(?:\.\.\/)+apps\//.test(spec)
    ) {
      violations.push({
        file,
        line,
        rule: "no-deep-cross-package-relative",
        importPath: spec,
      });
    }

    // FSD: lower layers must not import upper layers (package 17 TEST)
    if (file.startsWith("apps/web/src/")) {
      const FSD_RANK = {
        app: 0,
        pages: 1,
        widgets: 2,
        features: 3,
        entities: 4,
        shared: 5,
      };
      const layerOf = (f) => {
        const m = f.match(/^apps\/web\/src\/(app|pages|widgets|features|entities|shared)(?:\/|$)/);
        return m ? m[1] : null;
      };
      const fromLayer = layerOf(file);
      // Resolve without extension for layer detection
      let target = rAbs;
      if (!/\.(ts|tsx|js|mjs)$/.test(target)) {
        for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
          if (fs.existsSync(path.join(ROOT, target + ext))) {
            target = target + ext;
            break;
          }
        }
      }
      const toLayer = layerOf(target);
      if (fromLayer && toLayer && FSD_RANK[fromLayer] > FSD_RANK[toLayer]) {
        violations.push({
          file,
          line,
          rule: "web-fsd-no-upward-import",
          importPath: spec,
        });
      }
    }
  }
}

for (const g of SRC_GLOBS) {
  for (const f of walk(path.join(ROOT, g))) checkFile(f);
}

if (violations.length) {
  console.error(`BOUNDARY VIOLATIONS (${violations.length}):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}] import "${v.importPath}"`);
  }
  process.exit(1);
}

console.log("BOUNDARY CHECK: OK");
process.exit(0);
