#!/usr/bin/env node
/**
 * generate-openapi-types.mjs — openapi-typescript codegen + SHA stamp (package 15).
 *
 * Usage: node scripts/generate-openapi-types.mjs
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPEC = path.join(ROOT, "openapi/openapi.yaml");
const OUT = path.join(
  ROOT,
  "apps/web/src/shared/api/generated/openapi.types.ts",
);

const hash = crypto.createHash("sha256").update(fs.readFileSync(SPEC)).digest("hex");

const yaml = fs.readFileSync(SPEC, "utf8");
const versionMatch = yaml.match(/^\s*version:\s*([^\s]+)/m);
const apiVersion = versionMatch?.[1] ?? "0.0.0";

execSync(
  `pnpm exec openapi-typescript "${SPEC}" -o "${OUT}.gen.ts"`,
  { cwd: ROOT, stdio: "inherit" },
);

const generated = fs.readFileSync(`${OUT}.gen.ts`, "utf8");
fs.unlinkSync(`${OUT}.gen.ts`);

const banner = `/**
 * Generated OpenAPI client types (package 15).
 * Regenerate: \`pnpm openapi:gen\` (openapi-typescript + drift stamp).
 *
 * OPENAPI_SPEC_SHA256 must match sha256 of openapi/openapi.yaml.
 *
 * @generated
 */
export const OPENAPI_SPEC_VERSION = "${apiVersion}" as const;

/** sha256 hex of openapi/openapi.yaml at generation time — drift CI fails on mismatch */
export const OPENAPI_SPEC_SHA256 =
  "${hash}" as const;

`;

fs.writeFileSync(OUT, banner + generated);
console.log(`OPENAPI GEN: wrote ${OUT} (sha=${hash}, version=${apiVersion})`);
