/**
 * Package 26 — capability breakdown placeholder tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildBreakdownRows,
  enabledCapabilitiesForLegend,
} from "../capability-breakdown.ts";

const baseCaps = {
  discovery: false,
  auditLogs: true,
  adsCloud: true,
  adsOutpost: false,
  dspm: true,
  registry: false,
  serverless: false,
  egress: false,
};

describe("capability-breakdown", () => {
  it("adds placeholder rows for enabled caps without line items", () => {
    const estimate = {
      lineItems: [
        {
          capability: "audit_logs",
          meterId: "eh-standard-tu",
          amount: 10,
          confidence: "High",
        },
      ],
      totals: { expected: 10 },
    };
    const rows = buildBreakdownRows(estimate as never, baseCaps, []);
    expect(rows.some((r) => r.capability === "ads_cloud" && r.placeholder)).toBe(
      true,
    );
    expect(rows.some((r) => r.capability === "dspm" && r.placeholder)).toBe(
      true,
    );
  });

  it("legend includes audit_logs when egress enabled", () => {
    const caps = { ...baseCaps, egress: true };
    const legend = enabledCapabilitiesForLegend(caps);
    expect(legend).toContain("audit_logs");
  });

  it("passes per-line verification provenance through to the row", () => {
    const estimate = {
      lineItems: [
        {
          capability: "audit_logs",
          meterId: "eh-standard-tu",
          amount: 10,
          confidence: "High",
          verification: {
            trusted: true,
            verdict: "verified",
            sourceUrl: "https://example.com/eh",
          },
        },
      ],
      totals: { expected: 10 },
    };
    const rows = buildBreakdownRows(estimate as never, baseCaps, []);
    const row = rows.find((r) => r.meterId === "eh-standard-tu");
    expect(row?.verification?.trusted).toBe(true);
    expect(row?.verification?.sourceUrl).toBe("https://example.com/eh");
  });

  it("EDGE: placeholder rows carry no verification (nothing to vouch for)", () => {
    const estimate = { lineItems: [], totals: { expected: 0 } };
    const rows = buildBreakdownRows(estimate as never, baseCaps, []);
    for (const r of rows) expect(r.verification).toBeUndefined();
  });
});
