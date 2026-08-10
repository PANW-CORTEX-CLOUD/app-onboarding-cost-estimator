#!/usr/bin/env node
/**
 * estimate.mjs — CLI to POST /v1/estimates and verify golden amounts via the API.
 *
 * REQ: Customer / SE can quote customer-cloud TCO from the shell against the live API.
 * AC: `pnpm estimate:check` hits GET /v1/health + POST /v1/estimates and exits 0 iff
 *     Azure audit-only meters + TU/blob math (and fallback golden when applicable) pass.
 * EDGE: API unreachable, non-2xx, wrong meters, or amount drift → non-zero + stderr detail.
 *
 * Usage:
 *   pnpm estimate -- --provider azure --region eastus --cap auditLogs
 *   pnpm estimate -- --body ./payload.json
 *   pnpm estimate:check
 *   node scripts/estimate.mjs --check --base-url http://127.0.0.1:8787
 *
 * Env: API_BASE (default http://127.0.0.1:8787)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AZURE_AUDIT_GOLDEN_REQUEST,
  DEFAULT_API_BASE,
  DISCOVERY_ONLY_REQUEST,
  assertAzureAuditGolden,
  assertDiscoveryOnlyZero,
  formatEstimateTable,
} from "./lib/estimate-check.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function status(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function usage(exitCode = 0) {
  const text = `Usage: node scripts/estimate.mjs [options]

Options:
  --base-url <url>     API base (default ${DEFAULT_API_BASE} or API_BASE)
  --provider <p>       azure | aws | gcp
  --region <r>         Region id (e.g. eastus)
  --cap <name>         Enable capability (repeatable): auditLogs, discovery, …
  --peak-mbps <n>      volume.peakMBps
  --ingress-gb-day <n> volume.ingressGBPerDay
  --peak-eps <n>       volume.peakEventsPerSec
  --avg-stored-gb <n>  volume.avgStoredGB
  --override-stream    volume.overrideStreamMetrics=true
  --body <file>        JSON CreateEstimateRequest (overrides flags)
  --json               Print raw EstimateResponse JSON
  --check              Run Azure audit + discovery golden checks via API
  --help               Show help

Examples:
  pnpm estimate -- --provider azure --region eastus --cap auditLogs --override-stream --peak-mbps 1 --peak-eps 1000 --ingress-gb-day 10 --avg-stored-gb 1
  pnpm estimate:check
`;
  console.log(text);
  process.exit(exitCode);
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const out = {
    baseUrl: process.env.API_BASE || DEFAULT_API_BASE,
    provider: null,
    region: null,
    caps: [],
    peakMBps: null,
    ingressGBPerDay: null,
    peakEventsPerSec: null,
    avgStoredGB: null,
    overrideStream: false,
    bodyPath: null,
    json: false,
    check: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null || v.startsWith("--")) {
        throw new Error(`Missing value after ${a}`);
      }
      return v;
    };
    // pnpm/npm may forward a lone `--` into argv; ignore it.
    if (a === "--") continue;
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--check") out.check = true;
    else if (a === "--json") out.json = true;
    else if (a === "--override-stream") out.overrideStream = true;
    else if (a === "--base-url") out.baseUrl = next().replace(/\/$/, "");
    else if (a === "--provider") out.provider = next();
    else if (a === "--region") out.region = next();
    else if (a === "--cap") out.caps.push(next());
    else if (a === "--peak-mbps") out.peakMBps = Number(next());
    else if (a === "--ingress-gb-day") out.ingressGBPerDay = Number(next());
    else if (a === "--peak-eps") out.peakEventsPerSec = Number(next());
    else if (a === "--avg-stored-gb") out.avgStoredGB = Number(next());
    else if (a === "--body") out.bodyPath = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 */
export function buildRequestFromFlags(args) {
  if (args.bodyPath) {
    const abs = path.isAbsolute(args.bodyPath)
      ? args.bodyPath
      : path.resolve(process.cwd(), args.bodyPath);
    const raw = fs.readFileSync(abs, "utf8");
    return JSON.parse(raw);
  }
  if (!args.provider || !args.region) {
    throw new Error("Require --provider and --region (or --body / --check)");
  }
  /** @type {Record<string, boolean>} */
  const capabilities = {};
  for (const c of args.caps) {
    capabilities[c] = true;
  }
  if (Object.keys(capabilities).length === 0) {
    capabilities.auditLogs = true;
  }
  /** @type {Record<string, unknown>} */
  const volume = {};
  if (args.peakMBps != null) volume.peakMBps = args.peakMBps;
  if (args.ingressGBPerDay != null) volume.ingressGBPerDay = args.ingressGBPerDay;
  if (args.peakEventsPerSec != null) {
    volume.peakEventsPerSec = args.peakEventsPerSec;
  }
  if (args.avgStoredGB != null) volume.avgStoredGB = args.avgStoredGB;
  if (args.overrideStream) volume.overrideStreamMetrics = true;

  return {
    provider: args.provider,
    region: args.region,
    capabilities,
    ...(Object.keys(volume).length ? { volume } : {}),
  };
}

/**
 * @param {string} baseUrl
 * @param {string} method
 * @param {string} apiPath
 * @param {unknown} [body]
 */
export async function apiFetch(baseUrl, method, apiPath, body) {
  const url = `${baseUrl}${apiPath}`;
  /** @type {RequestInit} */
  const init = {
    method,
    headers: { Accept: "application/json" },
  };
  if (body !== undefined) {
    init.headers = {
      ...init.headers,
      "Content-Type": "application/json",
    };
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `API unreachable at ${url}: ${msg}. Start with: pnpm dev:api`,
    );
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${apiPath} → HTTP ${res.status}: ${typeof json === "object" ? JSON.stringify(json) : text}`,
    );
  }
  return json;
}

/**
 * @param {string} baseUrl
 */
export async function runCheck(baseUrl) {
  const errors = [];
  const summaries = [];

  status(`check: GET ${baseUrl}/v1/health`);
  const health = await apiFetch(baseUrl, "GET", "/v1/health");
  if (health.status !== "ok") {
    errors.push(`health status expected ok, got ${health.status}`);
  } else {
    summaries.push(
      `health ok modelVersion=${health.modelVersion} apiVersion=${health.apiVersion}`,
    );
  }

  const region = AZURE_AUDIT_GOLDEN_REQUEST.region;
  status(`check: GET ${baseUrl}/v1/rates?provider=azure&region=${region}`);
  const rates = await apiFetch(
    baseUrl,
    "GET",
    `/v1/rates?provider=azure&region=${encodeURIComponent(region)}`,
  );

  status(`check: POST ${baseUrl}/v1/estimates (azure audit golden)`);
  const audit = await apiFetch(
    baseUrl,
    "POST",
    "/v1/estimates",
    AZURE_AUDIT_GOLDEN_REQUEST,
  );
  const auditResult = assertAzureAuditGolden(audit, {
    unitPrices: rates.unitPrices ?? {},
    ratesSource: rates.ratesSource,
  });
  summaries.push(...auditResult.summary);
  errors.push(...auditResult.errors);

  status(`check: POST ${baseUrl}/v1/estimates (discovery-only)`);
  const discovery = await apiFetch(
    baseUrl,
    "POST",
    "/v1/estimates",
    DISCOVERY_ONLY_REQUEST,
  );
  const discResult = assertDiscoveryOnlyZero(discovery);
  summaries.push(...discResult.summary);
  errors.push(...discResult.errors);

  return { ok: errors.length === 0, errors, summaries, audit, discovery, rates };
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    usage(1);
  }
  if (args.help) usage(0);

  const baseUrl = args.baseUrl.replace(/\/$/, "");

  if (args.check) {
    status(`estimate CLI check against ${baseUrl}`);
    let result;
    try {
      result = await runCheck(baseUrl);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
    for (const s of result.summaries) status(`ok: ${s}`);
    if (!result.ok) {
      console.error("ESTIMATE CHECK FAILED:");
      for (const e of result.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    status("ESTIMATE CHECK: PASS");
    if (args.json) {
      console.log(JSON.stringify({ audit: result.audit, discovery: result.discovery }, null, 2));
    } else {
      console.log("\n--- azure audit-only ---");
      console.log(formatEstimateTable(result.audit));
    }
    process.exit(0);
  }

  let body;
  try {
    body = buildRequestFromFlags(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    usage(1);
  }

  status(`POST ${baseUrl}/v1/estimates`);
  let estimate;
  try {
    estimate = await apiFetch(baseUrl, "POST", "/v1/estimates", body);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(estimate, null, 2));
  } else {
    console.log(formatEstimateTable(estimate));
  }
  process.exit(0);
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirect) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
