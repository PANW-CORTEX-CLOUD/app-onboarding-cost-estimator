/**
 * Client-side estimate export (JSON/CSV/PDF) — no cost-engine import.
 * Fail closed on critical-stale rates without explicit ack (EDGE).
 */
import type { EstimateResponse } from "../../entities/estimate/types.ts";
import { ESTIMATE_DISCLAIMER } from "../../shared/model/disclaimer.ts";

export type ExportFreshness = {
  level?: "fresh" | "warn" | "critical";
  requiresAckBeforeExport?: boolean;
  banner?: string | null;
};

export type EstimateExportPayload = {
  provider: string;
  modelVersion: string;
  ratesAsOf: string;
  disclaimer: string;
  confidence: string;
  inputHash: string;
  ratesSource?: string;
  totals: EstimateResponse["totals"];
  lineItems: Array<{
    provider: string;
    capability: string;
    meterId: string;
    amount: number;
    confidence: string;
  }>;
  warnings?: string[];
  exportedAt: string;
  ackCriticalStale?: boolean;
  /** Package 20 — forward projection series when available. */
  projection?: {
    series: Array<{
      month: number;
      expected: number;
      cumulative: number;
      volumeIndex: number;
    }>;
    total: number;
    annualGrowthPercent: number;
    disclaimer?: string;
  };
  /** Effective model assumptions at export time (package 28). */
  assumptions?: Record<string, unknown>;
};

export class ExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportBlockedError";
  }
}

export function buildEstimateExport(
  estimate: EstimateResponse,
  opts: {
    freshness?: ExportFreshness | null;
    ackCriticalStale?: boolean;
    projection?: EstimateExportPayload["projection"];
    assumptions?: Record<string, unknown>;
  } = {},
): EstimateExportPayload {
  const needsAck =
    opts.freshness?.requiresAckBeforeExport === true ||
    opts.freshness?.level === "critical";
  if (needsAck && opts.ackCriticalStale !== true) {
    throw new ExportBlockedError(
      "critical-stale rates require Ack before export (ackCriticalStale)",
    );
  }

  // Never hide Low confidence in export rows.
  return {
    provider: estimate.provider,
    modelVersion: estimate.modelVersion,
    ratesAsOf: estimate.ratesAsOf,
    disclaimer: ESTIMATE_DISCLAIMER,
    confidence: estimate.confidence,
    inputHash: estimate.inputHash,
    ratesSource: estimate.ratesSource,
    totals: estimate.totals,
    lineItems: estimate.lineItems.map((li) => ({
      provider: li.provider,
      capability: li.capability,
      meterId: li.meterId,
      amount: li.amount,
      confidence: li.confidence,
    })),
    warnings: estimate.warnings,
    exportedAt: new Date().toISOString(),
    ackCriticalStale: opts.ackCriticalStale,
    ...(opts.projection ? { projection: opts.projection } : {}),
    ...(opts.assumptions ? { assumptions: opts.assumptions } : {}),
  };
}

export function exportToJson(payload: EstimateExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function exportToCsv(payload: EstimateExportPayload): string {
  const header = [
    "provider",
    "capability",
    "meterId",
    "amount",
    "confidence",
    "modelVersion",
    "ratesAsOf",
    "disclaimer",
  ];
  const rows = payload.lineItems.map((li) =>
    [
      li.provider,
      li.capability,
      li.meterId,
      String(li.amount),
      li.confidence,
      payload.modelVersion,
      payload.ratesAsOf,
      JSON.stringify(payload.disclaimer),
    ].join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

/** Minimal single-page PDF with key export fields (MVP). */
export function exportToPdf(payload: EstimateExportPayload): Uint8Array {
  const lines = [
    `Cloud Connector Cost Estimate`,
    `provider: ${payload.provider}`,
    `modelVersion: ${payload.modelVersion}`,
    `ratesAsOf: ${payload.ratesAsOf}`,
    `confidence: ${payload.confidence}`,
    `expected: ${payload.totals.expected}`,
    `disclaimer: ${payload.disclaimer}`,
    ...payload.lineItems.map(
      (li) =>
        `${li.capability}/${li.meterId}=${li.amount} (${li.confidence})`,
    ),
  ];
  const text = lines.join("\\n");
  const stream = `BT /F1 10 Tf 40 750 Td (${escapePdf(text)}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length ${stream.length} >>stream
${stream}
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
trailer<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF
`;
  return new TextEncoder().encode(pdf);
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SAAS_RE = /saas|license|cortex\s*cloud\s*subscription/i;

/** Fail closed if export somehow includes SaaS/license lines. */
export function assertNoSaasLines(payload: EstimateExportPayload): void {
  for (const li of payload.lineItems) {
    if (SAAS_RE.test(li.capability) || SAAS_RE.test(li.meterId)) {
      throw new ExportBlockedError(
        `SaaS/license line forbidden in export: ${li.capability}/${li.meterId}`,
      );
    }
  }
}
