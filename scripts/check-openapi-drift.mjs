#!/usr/bin/env node
/**
 * check-openapi-drift.mjs — Fail if committed OPENAPI_SPEC_SHA256 ≠ sha256(openapi/openapi.yaml).
 *
 * Usage:
 *   node scripts/check-openapi-drift.mjs           # verify
 *   node scripts/check-openapi-drift.mjs --write   # stamp generated types file
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPEC = path.join(ROOT, "openapi/openapi.yaml");
const TYPES = path.join(
  ROOT,
  "apps/web/src/shared/api/generated/openapi.types.ts",
);

function sha256File(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const hash = sha256File(SPEC);
const write = process.argv.includes("--write");

if (!fs.existsSync(TYPES)) {
  console.error(`MISSING generated types: ${TYPES}`);
  process.exit(1);
}

let text = fs.readFileSync(TYPES, "utf8");
const re = /export const OPENAPI_SPEC_SHA256 =\s*\n?\s*"([a-f0-9]+|PLACEHOLDER_WILL_BE_SET_BY_SCRIPT)" as const/;

if (write) {
  if (!re.test(text)) {
    console.error("GENERATED TYPES: missing OPENAPI_SPEC_SHA256 export");
    process.exit(1);
  }
  text = text.replace(
    re,
    `export const OPENAPI_SPEC_SHA256 =\n  "${hash}" as const`,
  );
  fs.writeFileSync(TYPES, text);
  console.log(`OPENAPI DRIFT: stamped ${hash}`);
  process.exit(0);
}

const m = text.match(re);
if (!m) {
  console.error("OPENAPI DRIFT: OPENAPI_SPEC_SHA256 not found in generated types");
  process.exit(1);
}
if (m[1] !== hash) {
  console.error(
    `OPENAPI DRIFT: expected ${hash}, got ${m[1]}\n` +
      `  Run: node scripts/check-openapi-drift.mjs --write`,
  );
  process.exit(1);
}

console.log("OPENAPI DRIFT: OK");
process.exit(0);
