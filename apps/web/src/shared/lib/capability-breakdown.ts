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

export type LineItemRow = {
  capability: string;
  meterId: string;
  amount: number;
  confidence: string;
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
};

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

export function enabledCapabilitiesForLegend(
  caps: CapabilityFlags,
): string[] {
  const set = new Set(enabledEngineCapabilities(caps));
  if (caps.egress) set.add("audit_logs");
  return [...set];
}

/**
 * Build breakdown rows: all line items plus placeholders for enabled caps with no meters.
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
