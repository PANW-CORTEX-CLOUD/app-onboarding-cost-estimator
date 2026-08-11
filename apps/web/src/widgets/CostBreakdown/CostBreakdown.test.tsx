/**
 * Per-line provenance surfacing: the breakdown table shows, for every meter,
 * whether its rate is vendor-backed and links to the official source — so a
 * reviewer can see *why* a line is trustworthy without reading engine source.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CostBreakdown } from "./CostBreakdown.tsx";
import type { EstimateResponse } from "../../entities/estimate/types.ts";

afterEach(() => cleanup());

function estimateWith(
  lineItems: EstimateResponse["lineItems"],
): EstimateResponse {
  return {
    provider: "azure",
    totals: { expected: 42, low: 40, high: 45 },
    confidence: "High",
    lineItems,
  } as unknown as EstimateResponse;
}

describe("CostBreakdown — per-line provenance", () => {
  it("renders a verified badge linking to the official source for a vendor-backed line", () => {
    const estimate = estimateWith([
      {
        provider: "azure",
        capability: "audit_logs",
        meterId: "eh-standard-tu",
        amount: 42,
        confidence: "High",
        verification: {
          verdict: "verified",
          verifiedAt: "2026-08-01",
          ageDays: 10,
          stale: false,
          trusted: true,
          sourceUrl: "https://azure.example/eh",
        },
      },
    ] as unknown as EstimateResponse["lineItems"]);

    render(<CostBreakdown estimate={estimate} />);
    const cell = screen.getByTestId("source-eh-standard-tu");
    const link = cell.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://azure.example/eh");
    expect(cell.textContent).toMatch(/verified/i);
  });

  it("EDGE: an untrusted line shows the verdict, not a source link", () => {
    const estimate = estimateWith([
      {
        provider: "aws",
        capability: "registry",
        meterId: "some-proxy-meter",
        amount: 5,
        confidence: "Low",
        verification: {
          verdict: "proxy",
          verifiedAt: "2026-08-01",
          ageDays: 10,
          stale: false,
          trusted: false,
          sourceUrl: "https://aws.example/x",
        },
      },
    ] as unknown as EstimateResponse["lineItems"]);

    render(<CostBreakdown estimate={estimate} />);
    const cell = screen.getByTestId("source-some-proxy-meter");
    expect(cell.querySelector("a")).toBeNull();
    expect(cell.textContent).toMatch(/proxy/);
  });

  it("flags a trusted-but-stale rate so the reviewer knows to re-verify", () => {
    const estimate = estimateWith([
      {
        provider: "gcp",
        capability: "ads_cloud",
        meterId: "pd-snapshot-storage",
        amount: 3,
        confidence: "Med",
        verification: {
          verdict: "verified",
          verifiedAt: "2026-01-01",
          ageDays: 222,
          stale: true,
          trusted: true,
          sourceUrl: "https://gcp.example/disks",
        },
      },
    ] as unknown as EstimateResponse["lineItems"]);

    render(<CostBreakdown estimate={estimate} />);
    const cell = screen.getByTestId("source-pd-snapshot-storage");
    // Still links to the source (it IS vendor-backed) but is flagged stale.
    expect(cell.querySelector("a")).not.toBeNull();
    expect(cell.textContent).toMatch(/stale/i);
  });

  it("EDGE: a line with no verification renders a neutral dash, not a crash", () => {
    const estimate = estimateWith([
      {
        provider: "gcp",
        capability: "audit_logs",
        meterId: "no-verif",
        amount: 1,
        confidence: "Med",
      },
    ] as unknown as EstimateResponse["lineItems"]);

    render(<CostBreakdown estimate={estimate} />);
    const cell = screen.getByTestId("source-no-verif");
    expect(cell.querySelector("a")).toBeNull();
    expect(cell.textContent).toBe("—");
  });
});
