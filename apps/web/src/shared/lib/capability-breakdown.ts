/**
 * Map UI capability toggles to engine line-item capability names (package 26).
 */
export type CapabilityFlags = {
  discovery?: boolean;
  auditLogs?: boolean;
  adsCloud?: boolean;
  adsOutpost?: boolean;
  dspm?: boolean;
  registry?: boolean;
  serverless?: boolean;
  egress?: boolean;
};

/**
 * Per-line provenance the UI surfaces so a reviewer can see *why* a line is
 * trustworthy without reading source: whether the rate is vendor-backed, the
 * ledger verdict, and a link to the official source. Mirrors the load-bearing
 * fields of the API's `MeterVerification` (a full import would pull the
 * generated OpenAPI types into this shared helper for three fields).
 */
export type RowVerification = {
  trusted: boolean;
  verdict: string;
  sourceUrl: string;
  /** True when a trusted rate is past its re-check window (still shown, flagged). */
  stale?: boolean;
  ageDays?: number;
};

export type LineItemRow = {
  capability: string;
  meterId: string;
  amount: number;
  confidence: string;
  verification?: RowVerification;
};

export type EstimateLike = {
  lineItems: LineItemRow[];
  totals: { expected: number };
  warnings?: string[];
};

/** Engine `lineItems[].capability` values per toggle (discovery has no meters). */
export const CAPABILITY_TOGGLE_TO_ENGINE: Record<
  Exclude<keyof CapabilityFlags, "discovery">,
  string
> = {
  auditLogs: "audit_logs",
  adsCloud: "ads_cloud",
  adsOutpost: "ads_outpost",
  dspm: "dspm",
  registry: "registry",
  serverless: "serverless",
  egress: "audit_logs",
};

export type BreakdownRow = {
  capability: string;
  meterId: string;
  amount: number;
  confidence: string;
  placeholder?: boolean;
  note?: string;
  verification?: RowVerification;
};

/**
 * Toggle flags → capability tokens for enabled capabilities (`discovery` excluded — no meters).
 * Note: returns the literal `"egress"` token, not the engine's `audit_logs` capability
 * that egress meters actually post under (see {@link CAPABILITY_TOGGLE_TO_ENGINE}) —
 * callers that need the real engine capability set should go through
 * {@link enabledCapabilitiesForLegend} instead, which corrects this.
 */
export function enabledEngineCapabilities(
  caps: CapabilityFlags,
): string[] {
  const out: string[] = [];
  if (caps.auditLogs) out.push("audit_logs");
  if (caps.adsCloud) out.push("ads_cloud");
  if (caps.adsOutpost) out.push("ads_outpost");
  if (caps.dspm) out.push("dspm");
  if (caps.registry) out.push("registry");
  if (caps.serverless) out.push("serverless");
  if (caps.egress) out.push("egress");
  return out;
}

/**
 * Capability tokens to show in a legend for the enabled toggles, de-duplicated.
 * Adds `audit_logs` when `egress` is enabled since egress cost actually posts
 * as an `audit_logs` line item ({@link CAPABILITY_TOGGLE_TO_ENGINE}) — without
 * this, an egress-only estimate would show a legend entry ("egress") that
 * never matches a real line item's capability.
 */
export function enabledCapabilitiesForLegend(
  caps: CapabilityFlags,
): string[] {
  const set = new Set(enabledEngineCapabilities(caps));
  if (caps.egress) set.add("audit_logs");
  return [...set];
}

/**
 * Build breakdown rows: all line items plus placeholders for enabled caps with no meters.
 * Placeholders always carry `amount: 0`, so appending them never changes the sum of
 * amounts — safe to feed straight into {@link aggregateCostDrivers} without skewing
 * its percentages relative to `estimate.totals.expected`.
 */
export function buildBreakdownRows(
  estimate: EstimateLike | null,
  caps: CapabilityFlags,
  warnings: string[] = [],
): BreakdownRow[] {
  if (!estimate) return [];
  const rows: BreakdownRow[] = estimate.lineItems.map((li) => ({
    capability: li.capability,
    meterId: li.meterId,
    amount: li.amount,
    confidence: li.confidence,
    ...(li.verification ? { verification: li.verification } : {}),
  }));

  const capsWithLines = new Set(rows.map((r) => r.capability));

  if (caps.adsCloud && !capsWithLines.has("ads_cloud")) {
    rows.push({
      capability: "ads_cloud",
      meterId: "—",
      amount: 0,
      confidence: "Med",
      placeholder: true,
      note: pickWarning(warnings, /ads|vm|disk|snapshot/i) ?? "No meter line (check vmCount / disk inputs)",
    });
  }
  if (caps.adsOutpost && !capsWithLines.has("ads_outpost")) {
    rows.push({
      capability: "ads_outpost",
      meterId: "—",
      amount: 0,
      confidence: "Low",
      placeholder: true,
      note: pickWarning(warnings, /outpost|scanner/i) ?? "No meter line",
    });
  }
  if (caps.dspm && !capsWithLines.has("dspm")) {
    rows.push({
      capability: "dspm",
      meterId: "—",
      amount: 0,
      confidence: "Low",
      placeholder: true,
      note: pickWarning(warnings, /dspm|estate/i) ?? "No meter line (set data estate GB)",
    });
  }
  if (caps.registry && !capsWithLines.has("registry")) {
    rows.push({
      capability: "registry",
      meterId: "—",
      amount: 0,
      confidence: "Low",
      placeholder: true,
      note: pickWarning(warnings, /registry|image/i) ?? "No meter line (set image count)",
    });
  }
  if (caps.serverless && !capsWithLines.has("serverless")) {
    rows.push({
      capability: "serverless",
      meterId: "—",
      amount: 0,
      confidence: "Low",
      placeholder: true,
      note: pickWarning(warnings, /serverless|package/i) ?? "No meter line",
    });
  }
  if (
    caps.egress &&
    !rows.some((r) => r.meterId.includes("egress") || r.capability === "egress")
  ) {
    rows.push({
      capability: "audit_logs",
      meterId: "egress (none)",
      amount: 0,
      confidence: "Low",
      placeholder: true,
      note: pickWarning(warnings, /egress/i) ?? "No egress meter (set egress GB)",
    });
  }

  return rows;
}

function pickWarning(warnings: string[], re: RegExp): string | undefined {
  return warnings.find((w) => re.test(w));
}

export type ConfidenceBandTotals = {
  High: number;
  Med: number;
  Low: number;
  total: number;
};

/**
 * Split priced lines into dollar subtotals per confidence band.
 *
 * Every meter is vendor-backed now, but the *estimator's* declared confidence
 * still varies — an audit line is High, an ADS Outpost compute line is Low — and
 * a single headline total hides that spread. This lets the UI say "of $X, $A is
 * High-confidence and $C is Low", so a reviewer sees how much of the number
 * rests on the softer estimates.
 *
 * `total` is defined as `High + Med + Low`, so it always reconciles with the
 * band sum: an unrecognised confidence string is folded into **Low** (an unknown
 * confidence is never High), rather than silently dropped, so no dollar goes
 * unaccounted for. Non-finite amounts are skipped.
 */
export function confidenceBandTotals(
  rows: readonly { amount: number; confidence: string }[],
): ConfidenceBandTotals {
  const bands: ConfidenceBandTotals = { High: 0, Med: 0, Low: 0, total: 0 };
  for (const r of rows) {
    if (!Number.isFinite(r.amount)) continue;
    if (r.confidence === "High") bands.High += r.amount;
    else if (r.confidence === "Med") bands.Med += r.amount;
    else bands.Low += r.amount; // Low, or any unrecognised band (conservative).
  }
  bands.total = bands.High + bands.Med + bands.Low;
  return bands;
}
