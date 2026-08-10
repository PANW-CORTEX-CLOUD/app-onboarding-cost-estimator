#!/usr/bin/env node
/**
 * validate-prices.mjs — age-driven re-verification of every priced meter.
 *
 * Each row in sources/price-validations.json records when its price was last
 * actually compared against the official source (`verifiedAt`). That age is
 * what schedules work: a row is only re-crawled once it is older than
 * maxAgeDays for its method, so a normal run costs nothing and a neglected
 * repo re-checks itself.
 *
 * Modes
 *   --check          Offline CI gate. No network. Fails when a row is stale,
 *                    mismatched, or when fallback-prices.json disagrees with
 *                    the ledger. This is what `pnpm test` runs.
 *   (default)        Crawl the official sources for rows that are due.
 *   --all            Crawl every row, ignoring age.
 *   --only=<meterId> Crawl one row (repeatable, comma separated).
 *   --write          Persist observed prices / verdicts / verifiedAt.
 *
 * Sources used
 *   azure-retail-api    https://prices.azure.com/api/retail/prices  (public, no auth)
 *   aws-price-list-api  https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/...
 *   official-doc        pricing pages that publish no machine-readable feed;
 *                       reported for manual re-check, never auto-passed.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "sources/price-validations.json");
const FALLBACK_PATHS = {
  azure: "packages/cost-engine/src/providers/azure/fallback-prices.json",
  aws: "packages/cost-engine/src/providers/aws/fallback-prices.json",
  gcp: "packages/cost-engine/src/providers/gcp/fallback-prices.json",
};

const AZURE_RETAIL_URL = "https://prices.azure.com/api/retail/prices";
const AWS_OFFER_BASE = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws";
/** Region-scoped offers are small; these global ones are fetched whole. */
const AWS_GLOBAL_OFFERS = new Set(["AWSDataTransfer"]);
/** Offers too large to hold in memory — streamed line by line instead. */
const AWS_STREAMED_OFFERS = new Set(["AmazonEC2"]);
/** Relative price tolerance when comparing to the official number. */
const PRICE_TOLERANCE = 1e-9;

const argv = process.argv.slice(2);
const CHECK_ONLY = argv.includes("--check");
const CRAWL_ALL = argv.includes("--all");
const WRITE = argv.includes("--write");
const ONLY = new Set(
  argv
    .filter((a) => a.startsWith("--only="))
    .flatMap((a) => a.slice("--only=".length).split(","))
    .filter(Boolean),
);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function ageDays(iso, now) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, now.getTime() - then) / 86_400_000);
}

function closeEnough(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale <= PRICE_TOLERANCE;
}

function readLedger() {
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
}

/* ------------------------------------------------------------------ *
 * Ledger ↔ rate-file binding (runs in every mode)
 * ------------------------------------------------------------------ */

/**
 * Ledger ↔ rate-file binding.
 *
 * This used to be a second implementation of the rule that lives in the
 * engine's `assertFallbackMatchesLedger`, and the two drifted the first time
 * the rule changed: retiring a meter satisfied the engine and still failed
 * here. Importing the engine's version keeps one definition of what "the
 * ledger and the rate files agree" means.
 *
 * The import is dynamic because this script is plain .mjs and the engine is
 * TypeScript — `node --experimental-strip-types` handles it, which is why the
 * package.json entry point passes that flag.
 *
 * @returns {Promise<string[]>} one message per problem; empty when consistent
 */
async function checkLedgerBinding(ledger) {
  const engineDir = path.join(ROOT, "packages/cost-engine/src/providers/rates");
  const { assertFallbackMatchesLedger } = await import(
    path.join(engineDir, "price-validation.ts")
  );
  const { loadFallbackFile } = await import(
    path.join(engineDir, "fallback-schema.ts")
  );

  const problems = [];
  for (const [provider, rel] of Object.entries(FALLBACK_PATHS)) {
    try {
      assertFallbackMatchesLedger(loadFallbackFile(path.join(ROOT, rel)), ledger);
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      // The engine's drift error is a header line followed by one line per
      // problem. Anything else — a malformed rate file, an unreadable path —
      // is a single line, and stripping a header that is not there swallowed
      // it entirely. Only strip when the header is actually present.
      const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
      const isDriftReport = /^price-validations drift \(\d+\)/.test(lines[0] ?? "");
      problems.push(...(isDriftReport ? lines.slice(1) : [`${provider}: ${message}`]));
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ *
 * Azure Retail Prices API
 * ------------------------------------------------------------------ */

async function azureRetailItems(region, serviceName) {
  const filter = `armRegionName eq '${region}' and serviceName eq '${serviceName}' and priceType eq 'Consumption'`;
  const items = [];
  let url = `${AZURE_RETAIL_URL}?${new URLSearchParams({ $filter: filter })}`;
  for (let page = 0; page < 12 && url; page += 1) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`azure retail HTTP ${res.status}`);
    const body = await res.json();
    items.push(...(body.Items ?? []));
    url = body.NextPageLink ?? null;
  }
  return items;
}

/**
 * Rows carrying `expectAbsent` assert the opposite of a price claim: that the
 * official list has NO such meter. Finding nothing confirms the assertion;
 * finding something falsifies it and is reported as a mismatch. This keeps
 * "we made this number up" an auditable, re-checkable statement rather than a
 * comment someone has to trust.
 */
function absentResult(row, note) {
  if (row.probe?.expectAbsent) {
    return {
      verdict: "unsupported-meter",
      observed: { unitPrice: null, note, assertionHeld: true },
    };
  }
  return { verdict: "unsupported-meter", observed: { unitPrice: null, note } };
}

/**
 * `attributionMismatch` rows price a real SKU that belongs to a different
 * service than the meterId names. The number is checked against the offer it
 * really comes from, then downgraded to `proxy` so nothing presents it as a
 * price published by the named service.
 */
function withAttribution(row, result) {
  if (row.probe?.attributionMismatch && result.verdict === "verified") {
    return { ...result, verdict: "proxy" };
  }
  if (row.probe?.expectAbsent && result.verdict !== "unsupported-meter") {
    return {
      ...result,
      verdict: "mismatch",
      observed: {
        ...result.observed,
        assertionHeld: false,
        note: "row asserts this meter does not exist, but the official list has a match",
      },
    };
  }
  return result;
}

const azureCache = new Map();

async function probeAzure(row) {
  const { probe } = row;
  const key = `${row.region}|${probe.serviceName}`;
  if (!azureCache.has(key)) {
    azureCache.set(key, await azureRetailItems(row.region, probe.serviceName));
  }
  const items = azureCache.get(key);

  let matches = items.filter((i) => i.currencyCode === "USD");
  if (probe.meterName && probe.meterName !== "*") {
    matches = matches.filter((i) => i.meterName === probe.meterName);
  }
  if (probe.productName) {
    matches = matches.filter((i) => i.productName === probe.productName);
  }
  if (probe.armSkuName) {
    matches = matches.filter((i) => i.armSkuName === probe.armSkuName);
  }
  if (probe.expectedUnitOfMeasure) {
    matches = matches.filter(
      (i) => i.unitOfMeasure === probe.expectedUnitOfMeasure,
    );
  }
  // Retail lists $0.00 rows for free grants and reservation shells.
  matches = matches.filter((i) => typeof i.retailPrice === "number" && i.retailPrice > 0);

  if (matches.length === 0) {
    return absentResult(
      row,
      `no USD Consumption item matched serviceName=${probe.serviceName} meterName=${probe.meterName ?? "*"} unitOfMeasure=${probe.expectedUnitOfMeasure ?? "*"} in ${row.region}`,
    );
  }

  // Several capacity/egress meters publish one row per volume tier. `pick`
  // says which tier the estimator prices — "max" is the first (most expensive) tier.
  const chosen =
    probe.pick === "max"
      ? matches.reduce((a, b) => (b.retailPrice > a.retailPrice ? b : a))
      : matches.reduce((a, b) => (b.retailPrice < a.retailPrice ? b : a));

  const scale = probe.scaleToClaimed ?? 1;
  const derived = chosen.retailPrice * scale;
  return withAttribution(row, {
    verdict: closeEnough(derived, row.claimedUnitPrice) ? "verified" : "mismatch",
    observed: {
      unitPrice: chosen.retailPrice,
      unitOfMeasure: chosen.unitOfMeasure,
      skuName: chosen.skuName,
      productName: chosen.productName,
      ...(scale !== 1 ? { derivedClaimedUnitPrice: derived } : {}),
      ...(matches.length > 1
        ? { tiersSeen: matches.map((m) => m.retailPrice).sort((a, b) => b - a) }
        : {}),
    },
  });
}

/* ------------------------------------------------------------------ *
 * AWS Price List bulk API
 * ------------------------------------------------------------------ */

function awsOfferUrl(offer, region) {
  return AWS_GLOBAL_OFFERS.has(offer)
    ? `${AWS_OFFER_BASE}/${offer}/current/index.json`
    : `${AWS_OFFER_BASE}/${offer}/current/${region}/index.json`;
}

const awsCache = new Map();

async function awsOfferDoc(offer, region) {
  const key = `${offer}|${region}`;
  if (!awsCache.has(key)) {
    const res = await fetch(awsOfferUrl(offer, region));
    if (!res.ok) throw new Error(`aws price list HTTP ${res.status} for ${offer}`);
    awsCache.set(key, await res.json());
  }
  return awsCache.get(key);
}

/** Probe keys that are not product attributes. */
const AWS_NON_ATTRIBUTE_KEYS = new Set([
  "offer",
  "expectedUnit",
  "scaleToClaimed",
  "beginRange",
  "pick",
  "expectAbsent",
  "attributionMismatch",
  "quote",
]);

/**
 * A probe key other than the reserved ones is matched against the product
 * attribute of the same name. `usagetype` also matches on suffix, because
 * region-scoped offers prefix it (USE1-Requests-Tier1).
 */
function awsRowMatches(attrs, probe) {
  for (const [key, want] of Object.entries(probe)) {
    if (AWS_NON_ATTRIBUTE_KEYS.has(key)) continue;
    const got = attrs[key];
    if (key === "usagetype") {
      const ut = got ?? "";
      if (ut !== want && !ut.endsWith(want)) return false;
      continue;
    }
    if (got !== want) return false;
  }
  return true;
}

/**
 * Multi-hundred-MB offers (EC2) are scanned as a stream: collect the SKUs whose
 * usagetype matches, then read their on-demand price dimensions, without ever
 * holding the whole document in memory.
 */
async function probeAwsStreamed(row) {
  const { probe } = row;
  const res = await fetch(awsOfferUrl(probe.offer, row.region));
  if (!res.ok) throw new Error(`aws price list HTTP ${res.status} for ${probe.offer}`);

  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  const wantedSkus = new Set();
  let currentSku = null;
  let currentAttrs = {};
  let inTerms = false;
  let pendingSku = null;
  let pending = null;
  const dims = [];

  const skuRe = /"sku"\s*:\s*"([^"]+)"/;
  const kvRe = /"([A-Za-z0-9_]+)"\s*:\s*"([^"]*)"/;
  const unitRe = /"unit"\s*:\s*"([^"]+)"/;
  const descRe = /"description"\s*:\s*"([^"]*)"/;
  const beginRe = /"beginRange"\s*:\s*"([^"]*)"/;
  const usdRe = /"USD"\s*:\s*"([^"]+)"/;

  // Products are evaluated at each sku boundary so only one attribute bag is
  // ever resident — the EC2 offer holds hundreds of thousands of products.
  const flushProduct = () => {
    if (currentSku && awsRowMatches(currentAttrs, probe)) {
      wantedSkus.add(currentSku);
    }
    currentAttrs = {};
  };

  // Reserved-instance terms repeat the same SKUs at much lower hourly rates,
  // so only the OnDemand block may contribute price dimensions.
  let inOnDemand = false;

  for await (const line of rl) {
    if (!inTerms && line.includes('"terms"')) {
      flushProduct();
      currentSku = null;
      inTerms = true;
    }
    if (inTerms) {
      if (/"OnDemand"\s*:\s*\{/.test(line)) inOnDemand = true;
      else if (/"Reserved"\s*:\s*\{/.test(line)) inOnDemand = false;
    }

    const sku = skuRe.exec(line);
    if (sku) {
      if (!inTerms) flushProduct();
      currentSku = sku[1];
      if (inTerms) {
        pendingSku = currentSku;
        pending = null;
      }
      continue;
    }

    if (!inTerms) {
      const kv = kvRe.exec(line);
      if (kv && currentSku) currentAttrs[kv[1]] = kv[2];
      continue;
    }

    if (!inOnDemand || !pendingSku || !wantedSkus.has(pendingSku)) continue;

    if (unitRe.test(line)) pending = { ...(pending ?? {}), unit: unitRe.exec(line)[1] };
    else if (descRe.test(line)) pending = { ...(pending ?? {}), description: descRe.exec(line)[1] };
    else if (beginRe.test(line)) pending = { ...(pending ?? {}), beginRange: beginRe.exec(line)[1] };
    else if (usdRe.test(line)) {
      dims.push({ ...(pending ?? {}), usd: Number(usdRe.exec(line)[1]) });
      pending = null;
    }
  }

  return finishAwsProbe(row, dims);
}

async function probeAwsInMemory(row) {
  const { probe } = row;
  const doc = await awsOfferDoc(probe.offer, row.region);
  const terms = doc.terms?.OnDemand ?? {};
  const dims = [];
  for (const [sku, product] of Object.entries(doc.products ?? {})) {
    if (!awsRowMatches(product.attributes ?? {}, probe)) continue;
    for (const term of Object.values(terms[sku] ?? {})) {
      for (const pd of Object.values(term.priceDimensions ?? {})) {
        dims.push({
          unit: pd.unit,
          description: pd.description,
          beginRange: pd.beginRange,
          usd: Number(pd.pricePerUnit?.USD),
        });
      }
    }
  }
  return finishAwsProbe(row, dims);
}

function finishAwsProbe(row, dimsRaw) {
  const { probe } = row;
  let dims = dimsRaw.filter((d) => Number.isFinite(d.usd) && d.usd > 0);
  if (probe.expectedUnit) dims = dims.filter((d) => d.unit === probe.expectedUnit);
  if (probe.beginRange !== undefined) {
    dims = dims.filter((d) => d.beginRange === probe.beginRange);
  }

  if (dims.length === 0) {
    return absentResult(
      row,
      `no priced ${probe.expectedUnit ?? ""} dimension matched usagetype=${probe.usagetype} in offer ${probe.offer}`,
    );
  }

  const chosen =
    probe.pick === "max"
      ? dims.reduce((a, b) => (b.usd > a.usd ? b : a))
      : dims.reduce((a, b) => (b.usd < a.usd ? b : a));
  const scale = probe.scaleToClaimed ?? 1;
  const derived = chosen.usd * scale;
  return withAttribution(row, {
    verdict: closeEnough(derived, row.claimedUnitPrice) ? "verified" : "mismatch",
    observed: {
      unitPrice: chosen.usd,
      unitOfMeasure: chosen.unit,
      description: chosen.description,
      ...(scale !== 1 ? { derivedClaimedUnitPrice: derived } : {}),
      ...(dims.length > 1
        ? { tiersSeen: dims.map((d) => d.usd).sort((a, b) => b - a) }
        : {}),
    },
  });
}

function probeAws(row) {
  return AWS_STREAMED_OFFERS.has(row.probe.offer)
    ? probeAwsStreamed(row)
    : probeAwsInMemory(row);
}

/* ------------------------------------------------------------------ *
 * Modes
 * ------------------------------------------------------------------ */

async function runCheck(ledger, now) {
  const failures = [];
  const binding = await checkLedgerBinding(ledger);
  failures.push(...binding);

  const blocked = [];
  for (const row of ledger.meters) {
    const max = ledger.maxAgeDays[row.method];
    if (row.verdict === "mismatch") {
      failures.push(
        `${row.provider}/${row.meterId}: verdict=mismatch — the estimator is billing a price the vendor does not publish`,
      );
    }
    // A row nobody can check (no public feed) still has to be looked at on
    // schedule; it just cannot be expected to turn green, so the attempt —
    // not the verification — resets its clock. It stays untrusted regardless.
    const clock = row.verifiedAt ?? (row.blockedReason ? row.lastAttemptedAt : null);
    const age = ageDays(clock, now);
    if (row.blockedReason) blocked.push(row);
    if (age > max) {
      const label = Number.isFinite(age) ? `${age}d` : "never checked";
      failures.push(
        `${row.provider}/${row.meterId}: last checked ${label} (limit ${max}d for ${row.method}) — run \`pnpm rates:validate --write\``,
      );
    }
  }

  const counts = {};
  for (const row of ledger.meters) {
    counts[row.verdict] = (counts[row.verdict] ?? 0) + 1;
  }
  log(
    `ledger: ${ledger.meters.length} meters — ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );

  const untrusted = ledger.meters.filter((m) => m.verdict !== "verified");
  if (untrusted.length) {
    console.log(
      `  ${untrusted.length} meter(s) are not vendor-backed and are forced to Low-confidence bands with a warning:`,
    );
    for (const m of untrusted) {
      console.log(`    ${m.provider}/${m.meterId} (${m.verdict})`);
    }
  }
  for (const row of blocked) {
    console.log(`  blocked: ${row.provider}/${row.meterId} — ${row.blockedReason}`);
  }

  if (failures.length) {
    console.error("PRICE VALIDATION GATE FAILED:");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  log("PRICE VALIDATION GATE: OK");
}

async function runCrawl(ledger, now) {
  const due = ledger.meters.filter((row) => {
    if (ONLY.size) return ONLY.has(row.meterId);
    if (CRAWL_ALL) return true;
    return ageDays(row.verifiedAt, now) > ledger.maxAgeDays[row.method];
  });

  if (due.length === 0) {
    log("nothing due — every meter is inside its re-check window");
    return;
  }
  log(`${due.length}/${ledger.meters.length} meter(s) due for re-verification`);

  const manual = [];
  let changed = 0;
  const today = now.toISOString().slice(0, 10);

  for (const row of due) {
    const age = ageDays(row.verifiedAt, now);
    const ageLabel = Number.isFinite(age) ? `${age}d old` : "never verified";
    if (row.method === "official-doc") {
      manual.push(row);
      log(`SKIP  ${row.provider}/${row.meterId} (${ageLabel}) — no machine-readable feed; re-read ${row.sourceUrl}`);
      continue;
    }

    try {
      const result =
        row.method === "azure-retail-api" ? await probeAzure(row) : await probeAws(row);
      const before = row.verdict;
      row.verdict = result.verdict;
      row.observed = result.observed;
      row.verifiedAt = today;
      changed += 1;
      const verdictNote = before === result.verdict ? "" : ` (was ${before})`;
      log(
        `${result.verdict === "verified" ? "OK   " : "DIFF "} ${row.provider}/${row.meterId} (${ageLabel}) → ${result.verdict}${verdictNote} observed=${result.observed.unitPrice ?? "none"} claimed=${row.claimedUnitPrice}`,
      );
    } catch (e) {
      log(`ERROR ${row.provider}/${row.meterId}: ${e instanceof Error ? e.message : e} — leaving verifiedAt untouched (fail closed)`);
    }
  }

  if (manual.length) {
    console.log("\nManual re-verification required (no public price API):");
    for (const row of manual) {
      console.log(`  ${row.provider}/${row.meterId} — claimed ${row.claimedUnitPrice}/${row.claimedUnit}`);
      console.log(`    ${row.sourceUrl}`);
      console.log(`    last quote: ${row.probe?.quote ?? "(none recorded)"}`);
    }
  }

  if (WRITE && changed > 0) {
    fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
    log(`wrote ${changed} updated row(s) to sources/price-validations.json`);
  } else if (changed > 0) {
    log(`${changed} row(s) would change — re-run with --write to persist`);
  }

  const mismatches = ledger.meters.filter((m) => m.verdict === "mismatch");
  if (mismatches.length) {
    console.error(
      `\n${mismatches.length} meter(s) now disagree with the official price list:`,
    );
    for (const m of mismatches) {
      console.error(
        `  ${m.provider}/${m.meterId}: claimed ${m.claimedUnitPrice}, official ${m.observed?.derivedClaimedUnitPrice ?? m.observed?.unitPrice}`,
      );
    }
    process.exit(1);
  }
}

async function main() {
  const now = new Date();
  const ledger = readLedger();
  if (CHECK_ONLY) {
    await runCheck(ledger, now);
    return;
  }
  const binding = await checkLedgerBinding(ledger);
  if (binding.length) {
    console.error("ledger ↔ rate-file drift must be fixed before crawling:");
    for (const b of binding) console.error(`  ${b}`);
    process.exit(1);
  }
  await runCrawl(ledger, now);
}

main().catch((e) => {
  console.error("validate-prices FATAL:", e);
  process.exit(1);
});
