#!/usr/bin/env node
/**
 * check-fallback-prices-age.mjs — CI age/drift gate for fallback-prices.json (package 16).
 * Fails closed when any meter capturedAt ageDays > FALLBACK_MAX_AGE_DAYS (90).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FALLBACK_MAX_AGE_DAYS = 90;

const FILES = [
  "packages/cost-engine/src/providers/azure/fallback-prices.json",
  "packages/cost-engine/src/providers/aws/fallback-prices.json",
  "packages/cost-engine/src/providers/gcp/fallback-prices.json",
];

function ageDays(capturedAt, now = new Date()) {
  const then = Date.parse(capturedAt);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, now.getTime() - then) / 86_400_000);
}

const now = new Date();
const failures = [];

for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const m of doc.meters ?? []) {
    const age = ageDays(m.capturedAt, now);
    if (age > FALLBACK_MAX_AGE_DAYS) {
      failures.push(
        `${rel} meter=${m.meterId} ageDays=${age} > ${FALLBACK_MAX_AGE_DAYS}`,
      );
    }
  }
  console.log(
    `FALLBACK AGE OK-check ${doc.provider}: meters=${doc.meters.length} (maxAge gate=${FALLBACK_MAX_AGE_DAYS})`,
  );
}

if (failures.length) {
  console.error("FALLBACK AGE GATE FAILED:");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log("FALLBACK AGE GATE: OK");
process.exit(0);
