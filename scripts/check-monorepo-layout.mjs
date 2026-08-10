#!/usr/bin/env node
/**
 * check-monorepo-layout.mjs — EDGE guards for package 03.
 * - No nested cost-estimator/ git repo
 * - Required workspace packages exist
 * - Engine package.json has no UI runtime deps
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const errors = [];

const nested = path.join(ROOT, "cost-estimator");
if (fs.existsSync(nested)) {
  errors.push("Nested cost-estimator/ directory must not exist under repo root");
}

const required = [
  "packages/cost-engine/package.json",
  "packages/api/package.json",
  "apps/web/package.json",
  "openapi/openapi.yaml",
  "sources/README.md",
  "docker-compose.dev.yml",
  "Dockerfile.dev",
  "docs/ESTIMATOR_UI_FLOW.md",
  "scripts/estimate.mjs",
  "scripts/lib/estimate-check.mjs",
  "packages/cost-engine/src/index.ts",
  "packages/cost-engine/src/model-version.ts",
  "apps/web/src/shared/api/generated/openapi.types.ts",
  "aws/README.md",
  "gcp/README.md",
];

for (const r of required) {
  if (!fs.existsSync(path.join(ROOT, r))) {
    errors.push(`Missing required path: ${r}`);
  }
}

const enginePkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages/cost-engine/package.json"), "utf8"),
);
const allDeps = {
  ...(enginePkg.dependencies ?? {}),
  ...(enginePkg.peerDependencies ?? {}),
};
const banned = ["react", "react-dom", "hono", "vite", "@vitejs/plugin-react"];
for (const b of banned) {
  if (allDeps[b]) {
    errors.push(`cost-engine must not declare UI/runtime dep: ${b}`);
  }
}

const webPkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8"),
);
const webDeps = {
  ...(webPkg.dependencies ?? {}),
  ...(webPkg.devDependencies ?? {}),
};
if (webDeps["@cloud-connector/api"]) {
  errors.push("web must not depend on @cloud-connector/api (use generated OpenAPI types)");
}
if (webDeps["@cloud-connector/cost-engine"]) {
  errors.push("web must not depend on cost-engine source (API proxy + generated types only)");
}

if (errors.length) {
  console.error("MONOREPO LAYOUT ERRORS:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("MONOREPO LAYOUT: OK");
process.exit(0);
