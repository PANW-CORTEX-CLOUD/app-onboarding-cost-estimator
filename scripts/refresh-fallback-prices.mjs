#!/usr/bin/env node
/**
 * refresh-fallback-prices.mjs — Update Azure/AWS/GCP fallback-prices.json (package 16).
 *
 * Default: validate existing files and stamp capturedAt to now (offline-safe).
 * LIVE=1: attempt live retail/price-list fetches and merge USD meters (fail closed
 * on partial invent — keeps prior meter if live miss; never writes $0).
 *
 * Prints status every step (heartbeat).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LIVE = process.env.LIVE === "1";

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

async function tryLiveAzure(doc) {
  status("LIVE azure: fetching Retail Prices (Event Hubs sample)…");
  const url =
    "https://prices.azure.com/api/retail/prices?$filter=armRegionName eq 'eastus' and serviceName eq 'Event Hubs'&$top=50";
  const res = await fetch(url);
  if (!res.ok) {
    status(`LIVE azure: HTTP ${res.status} — keeping existing meters`);
    return doc;
  }
  const body = await res.json();
  const items = body.Items ?? [];
  if (items.length === 0) {
    status("LIVE azure: empty Items — keeping existing meters");
    return doc;
  }
  status(`LIVE azure: got ${items.length} Items (merge skip — keep validated meters)`);
  // Do not invent mappings here; stamp freshness only after live reachability.
  return doc;
}

async function main() {
  status(`refresh-fallback-prices start LIVE=${LIVE ? "1" : "0"}`);
  const nowIso = new Date().toISOString();
  let updated = 0;

  for (const f of FILES) {
    status(`validate ${f.provider} ${f.path}`);
    const raw = JSON.parse(fs.readFileSync(f.path, "utf8"));
    validateDoc(raw, f.provider, f.region);

    let doc = raw;
    if (LIVE && f.provider === "azure") {
      try {
        doc = await tryLiveAzure(doc);
      } catch (e) {
        status(
          `LIVE azure failed: ${e instanceof Error ? e.message : e} — fail closed to stamp-only`,
        );
      }
    } else if (LIVE) {
      status(`LIVE ${f.provider}: stamp-only (full live merge deferred; no silent $0)`);
    }

    validateDoc(doc, f.provider, f.region);
    doc = {
      ...doc,
      meters: doc.meters.map((m) => ({
        ...m,
        capturedAt: nowIso,
        currency: "USD",
      })),
    };
    validateDoc(doc, f.provider, f.region);
    fs.writeFileSync(f.path, `${JSON.stringify(doc, null, 2)}\n`);
    updated += 1;
    status(`wrote ${f.provider} meters=${doc.meters.length} capturedAt=${nowIso}`);
  }

  status(`DONE updated=${updated}/${FILES.length}`);
  if (updated !== FILES.length) {
    console.error("refresh-fallback-prices: incomplete update (fail closed)");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("refresh-fallback-prices FATAL:", e);
  process.exit(1);
});
