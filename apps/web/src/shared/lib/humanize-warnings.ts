/**
 * Humanize estimate warning / note strings for SE-facing Cost reading.
 * Raw technical detail is preserved for progressive disclosure.
 */

export type HumanizedWarning = {
  /** Plain SE-facing sentence (never sole raw HTTP status). */
  summary: string;
  /** Original string when it adds detail beyond the summary. */
  detail: string | null;
};

/**
 * Map a raw warning string to human summary + optional raw detail.
 */
export function humanizeEstimateWarning(raw: string): HumanizedWarning {
  const w = raw.trim();
  if (!w) {
    return { summary: "Additional estimate note.", detail: null };
  }

  if (/429|rate.?limit|throttl/i.test(w)) {
    return {
      summary:
        "Cloud price API rate-limited — using cached or fallback list prices for this run.",
      detail: w,
    };
  }
  if (/fallback/i.test(w) && /http|using|rates?/i.test(w)) {
    return {
      summary:
        "Live retail rates unavailable — estimate uses published fallback list prices.",
      detail: w,
    };
  }
  if (/avgGB\s*=\s*0|floor|storage.?floor/i.test(w)) {
    return {
      summary:
        "Audit storage floor applied (avg stored GB was zero or below the model minimum).",
      detail: w,
    };
  }
  if (/\bTU\b|throughput.?unit|overage/i.test(w)) {
    return {
      summary:
        "Event Hub / stream capacity note — check peak MB/s and throughput units.",
      detail: w,
    };
  }
  if (/HTTP\s*\d{3}/i.test(w)) {
    return {
      summary:
        "A pricing or upstream request did not succeed — see technical detail.",
      detail: w,
    };
  }

  // Already human-readable — no separate detail panel.
  return { summary: w, detail: null };
}
