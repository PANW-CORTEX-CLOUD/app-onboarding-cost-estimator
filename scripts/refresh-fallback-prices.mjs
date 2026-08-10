#!/usr/bin/env node
/**
 * refresh-fallback-prices.mjs — validate Azure/AWS/GCP fallback-prices.json.
 *
 * This script used to stamp every meter's `capturedAt` to the current time
 * without looking at a single price. That made stale numbers report themselves
 * as freshly captured, and it silently satisfied the CI age gate — the two
 * things the age gate exists to catch. It no longer writes timestamps.
 *
 * `capturedAt` may only advance when a price was actually observed at the
 * source, which is what scripts/validate-prices.mjs does (and it records the
 * observation in sources/price-validations.json so the claim is auditable).
 *
 *   node scripts/refresh-fallback-prices.mjs            validate structure only
 *   node scripts/refresh-fallback-prices.mjs --stamp    advance capturedAt to the
 *                                                       ledger's verifiedAt dates
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STAMP = process.argv.includes("--stamp");

const FILES = [
  {
    provider: "azure",
    path: path.join(
      ROOT,
      "packages/cost-engine/src/providers/azure/fallback-prices.json",
    ),
    region: "eastus",
  },
  {
    provider: "aws",
    path: path.join(
      ROOT,
      "packages/cost-engine/src/providers/aws/fallback-prices.json",
    ),
    region: "us-east-1",
  },
  {
    provider: "gcp",
    path: path.join(
      ROOT,
      "packages/cost-engine/src/providers/gcp/fallback-prices.json",
    ),
    region: "us-central1",
  },
];

function status(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function validateDoc(doc, expectedProvider, expectedRegion) {
  if (!doc || typeof doc !== "object") throw new Error("doc must be object");
  if (doc.provider !== expectedProvider) {
    throw new Error(`provider mismatch: ${doc.provider}`);
  }
  if (doc.region !== expectedRegion) {
    throw new Error(`region mismatch: ${doc.region}`);
  }
  if (doc.currency !== "USD") throw new Error("currency must be USD");
  if (!Array.isArray(doc.meters) || doc.meters.length === 0) {
    throw new Error("meters required");
  }
  for (const m of doc.meters) {
    if (!m.meterId || typeof m.unitPrice !== "number" || !Number.isFinite(m.unitPrice)) {
      throw new Error(`invalid meter ${m.meterId}`);
    }
    if (m.unitPrice < 0) throw new Error(`negative price for ${m.meterId}`);
    if (m.currency !== "USD") throw new Error(`non-USD meter ${m.meterId}`);
    if (!m.capturedAt || Number.isNaN(Date.parse(m.capturedAt))) {
      throw new Error(`bad capturedAt for ${m.meterId}`);
    }
    if (!m.sourceUrl || !/^https?:\/\//.test(m.sourceUrl)) {
      throw new Error(`bad sourceUrl for ${m.meterId}`);
    }
  }
}

/** verifiedAt per meter from the validation ledger — the only legitimate capture date. */
function ledgerVerifiedDates() {
  const ledgerPath = path.join(ROOT, "sources/price-validations.json");
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const map = new Map();
  for (const row of ledger.meters ?? []) {
    if (row.verifiedAt) map.set(row.meterId, `${row.verifiedAt}T00:00:00.000Z`);
  }
  return map;
}

async function main() {
  status(`refresh-fallback-prices start STAMP=${STAMP ? "1" : "0"}`);
  const verified = STAMP ? ledgerVerifiedDates() : null;
  let checked = 0;
  const unstamped = [];

  for (const f of FILES) {
    status(`validate ${f.provider} ${f.path}`);
    const raw = JSON.parse(fs.readFileSync(f.path, "utf8"));
    validateDoc(raw, f.provider, f.region);

    if (!STAMP) {
      checked += 1;
      status(`ok ${f.provider} meters=${raw.meters.length} (capturedAt untouched)`);
      continue;
    }

    // Only meters the ledger says were actually observed get a new date.
    const doc = {
      ...raw,
      meters: raw.meters.map((m) => {
        const at = verified.get(m.meterId);
        if (!at) {
          unstamped.push(`${f.provider}/${m.meterId}`);
          return m;
        }
        return { ...m, capturedAt: at, currency: "USD" };
      }),
    };
    validateDoc(doc, f.provider, f.region);
    fs.writeFileSync(f.path, `${JSON.stringify(doc, null, 2)}\n`);
    checked += 1;
    status(`wrote ${f.provider} meters=${doc.meters.length} (dates from ledger verifiedAt)`);
  }

  if (unstamped.length) {
    status(
      `left untouched (never verified — run \`pnpm rates:validate --write\`): ${unstamped.join(", ")}`,
    );
  }

  status(`DONE updated=${checked}/${FILES.length}`);
  if (checked !== FILES.length) {
    console.error("refresh-fallback-prices: incomplete update (fail closed)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("refresh-fallback-prices FATAL:", e);
  process.exit(1);
});
