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
});
