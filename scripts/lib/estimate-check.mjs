/**
 * estimate-check.mjs — Pure golden assertions for the estimate CLI.
 *
 * Used by scripts/estimate.mjs after POST /v1/estimates (never invents $).
 * Azure audit-only fixture matches packages/cost-engine TF reconciliation tests:
 * 1 TU @ peak 1 MB/s · 1000 eps · overrideStreamMetrics · avgStoredGB=1.
 */

/** @typedef {{ meterId: string, amount: number, capability?: string }} LineItem */
/** @typedef {{
 *   provider: string,
 *   lineItems: LineItem[],
 *   totals: { expected: number, low?: number, high?: number },
 *   confidence?: string,
 *   ratesSource?: string,
 *   warnings?: string[],
 * }} EstimateResponse */

export const DEFAULT_API_BASE = "http://127.0.0.1:8787";

/** Azure TF audit billable meters (docs/TF_COST_RECONCILIATION.md). */
export const AZURE_TF_AUDIT_BILLABLE_METERS = [
  "eh-standard-tu",
  "eh-standard-ingress-events",
  "blob-hot-lrs-capacity",
];

/** Request body for Azure audit-only golden (engine + API SSOT). */
export const AZURE_AUDIT_GOLDEN_REQUEST = {
  provider: "azure",
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: {
    accountCount: 10,
    overrideStreamMetrics: true,
    ingressGBPerDay: 10,
    peakMBps: 1,
    peakEventsPerSec: 1000,
    avgStoredGB: 1,
  },
};

export const DISCOVERY_ONLY_REQUEST = {
  provider: "azure",
  region: "eastus",
  capabilities: { discovery: true },
};

/** Fallback-rate golden amounts when ratesSource is fallback (eastus). */
export const AZURE_AUDIT_FALLBACK_GOLDEN = {
  "eh-standard-tu": 21.9,
  "eh-standard-ingress-events": 8.930372266666668,
  "blob-hot-lrs-capacity": 0.0208,
  totalsExpected: 30.851172266666666,
};

export const AMOUNT_TOLERANCE = 0.01;

/**
 * @param {number} a
 * @param {number} b
 * @param {number} [tol]
 */
export function amountsClose(a, b, tol = AMOUNT_TOLERANCE) {
  return Math.abs(a - b) <= tol;
}

/**
 * Assert Azure audit-only estimate shape + capacity math against rate card.
 *
 * @param {EstimateResponse} estimate
 * @param {{ unitPrices: Record<string, number>, ratesSource?: string }} rates
 * @param {{ monthHours?: number, avgStoredGB?: number }} [opts]
 * @returns {{ ok: boolean, errors: string[], summary: string[] }}
 */
export function assertAzureAuditGolden(estimate, rates, opts = {}) {
  const errors = [];
  const summary = [];
  const monthHours = opts.monthHours ?? 730;
  const avgStoredGB = opts.avgStoredGB ?? 1;
  const tuPrice = rates?.unitPrices?.["eh-standard-tu"];
  const blobPrice = rates?.unitPrices?.["blob-hot-lrs-capacity"];

  if (!estimate || typeof estimate !== "object") {
    return { ok: false, errors: ["estimate response missing"], summary };
  }
  if (estimate.provider !== "azure") {
    errors.push(`provider expected azure, got ${estimate.provider}`);
  }
  if (!Array.isArray(estimate.lineItems)) {
    errors.push("lineItems missing");
    return { ok: false, errors, summary };
  }

  const ids = estimate.lineItems.map((l) => l.meterId).sort();
  const expectedIds = [...AZURE_TF_AUDIT_BILLABLE_METERS].sort();
  if (ids.join(",") !== expectedIds.join(",")) {
    errors.push(
      `meters expected [${expectedIds.join(", ")}], got [${ids.join(", ")}]`,
    );
  }

  const byId = Object.fromEntries(
    estimate.lineItems.map((l) => [l.meterId, l]),
  );

  if (typeof tuPrice !== "number" || !Number.isFinite(tuPrice) || tuPrice <= 0) {
    errors.push("rates.unitPrices[eh-standard-tu] missing or invalid");
  } else {
    const expectedTu = tuPrice * 1 * monthHours;
    const tu = byId["eh-standard-tu"];
    if (!tu) {
      errors.push("missing eh-standard-tu line");
    } else if (!amountsClose(tu.amount, expectedTu)) {
      errors.push(
        `eh-standard-tu $${tu.amount} ≠ 1 TU × $${tuPrice} × ${monthHours}h = $${expectedTu}`,
      );
    } else {
      summary.push(
        `eh-standard-tu $${tu.amount.toFixed(4)} ≈ 1 TU × $${tuPrice}/h × ${monthHours}h`,
      );
    }
  }

  if (
    typeof blobPrice === "number" &&
    Number.isFinite(blobPrice) &&
    blobPrice > 0
  ) {
    const expectedBlob = blobPrice * avgStoredGB;
    const blob = byId["blob-hot-lrs-capacity"];
    if (!blob) {
      errors.push("missing blob-hot-lrs-capacity line");
    } else if (!amountsClose(blob.amount, expectedBlob)) {
      errors.push(
        `blob-hot-lrs-capacity $${blob.amount} ≠ ${avgStoredGB} GB × $${blobPrice} = $${expectedBlob}`,
      );
    } else {
      summary.push(
        `blob-hot-lrs-capacity $${blob.amount.toFixed(4)} ≈ ${avgStoredGB} GB × $${blobPrice}/GB-mo`,
      );
    }
  }

  const sum = estimate.lineItems.reduce((s, l) => s + l.amount, 0);
  if (!amountsClose(sum, estimate.totals?.expected ?? NaN)) {
    errors.push(
      `totals.expected $${estimate.totals?.expected} ≠ sum(lineItems) $${sum}`,
    );
  } else {
    summary.push(`totals.expected $${Number(estimate.totals.expected).toFixed(4)}`);
  }

  const ingress = byId["eh-standard-ingress-events"];
  if (ingress) {
    summary.push(
      `eh-standard-ingress-events $${ingress.amount.toFixed(4)} (volume-driven)`,
    );
  }

  // When API served fallback rates, also pin absolute golden (fail closed on drift).
  if (rates.ratesSource === "fallback" || estimate.ratesSource === "fallback") {
    for (const [meterId, expected] of Object.entries(AZURE_AUDIT_FALLBACK_GOLDEN)) {
      if (meterId === "totalsExpected") continue;
      const line = byId[meterId];
      if (!line) continue;
      if (!amountsClose(line.amount, expected)) {
        errors.push(
          `fallback golden ${meterId}: got $${line.amount}, expected ≈ $${expected}`,
        );
      }
    }
    if (
      !amountsClose(
        estimate.totals.expected,
        AZURE_AUDIT_FALLBACK_GOLDEN.totalsExpected,
      )
    ) {
      errors.push(
        `fallback golden totals: got $${estimate.totals.expected}, expected ≈ $${AZURE_AUDIT_FALLBACK_GOLDEN.totalsExpected}`,
      );
    } else {
      summary.push("fallback absolute golden amounts match");
    }
  }

  return { ok: errors.length === 0, errors, summary };
}

/**
 * Discovery-only must be $0 with no invented meters.
 * @param {EstimateResponse} estimate
 */
export function assertDiscoveryOnlyZero(estimate) {
  const errors = [];
  const summary = [];
  if (estimate.provider !== "azure") {
    errors.push(`provider expected azure, got ${estimate.provider}`);
  }
  if (!Array.isArray(estimate.lineItems) || estimate.lineItems.length !== 0) {
    errors.push(
      `discovery-only must have 0 lineItems, got ${estimate.lineItems?.length ?? "missing"}`,
    );
  }
  if (!amountsClose(estimate.totals?.expected ?? NaN, 0)) {
    errors.push(`discovery-only totals.expected must be 0, got $${estimate.totals?.expected}`);
  } else {
    summary.push("discovery-only $0 (permission-only)");
  }
  return { ok: errors.length === 0, errors, summary };
}

/**
 * Format estimate for human CLI output.
 * @param {EstimateResponse} estimate
 */
export function formatEstimateTable(estimate) {
  const lines = [];
  lines.push(`provider=${estimate.provider} confidence=${estimate.confidence ?? "?"} ratesSource=${estimate.ratesSource ?? "?"}`);
  lines.push(
    `totals.expected=$${Number(estimate.totals?.expected ?? 0).toFixed(4)}` +
      (estimate.totals?.low != null
        ? ` band=[$${estimate.totals.low}, $${estimate.totals.high}]`
        : ""),
  );
  lines.push("meterId".padEnd(36) + "amount".padStart(12) + "  capability");
  lines.push("-".repeat(60));
  for (const l of estimate.lineItems ?? []) {
    lines.push(
      String(l.meterId).padEnd(36) +
        `$${Number(l.amount).toFixed(4)}`.padStart(12) +
        `  ${l.capability ?? ""}`,
    );
  }
  if (estimate.warnings?.length) {
    lines.push("warnings:");
    for (const w of estimate.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}
