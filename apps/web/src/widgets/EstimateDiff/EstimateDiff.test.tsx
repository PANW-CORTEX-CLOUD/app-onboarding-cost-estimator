/**
 * The diff panel shows only what moved, with signed deltas, and renders nothing
 * for a no-op diff (so an unchanged re-run adds no noise).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EstimateDiff } from "./EstimateDiff.tsx";
import { diffEstimates } from "../../shared/lib/estimate-diff.ts";

afterEach(() => cleanup());

describe("EstimateDiff", () => {
  it("renders moved meters with a signed total and hides unchanged ones", () => {
    const diff = diffEstimates(
      {
        lineItems: [
          { capability: "audit_logs", meterId: "eh-tu", amount: 100 },
          { capability: "dspm", meterId: "s3-get", amount: 50 },
        ],
        totals: { expected: 150 },
      },
      {
        lineItems: [
          { capability: "audit_logs", meterId: "eh-tu", amount: 100 }, // unchanged
          { capability: "dspm", meterId: "s3-get", amount: 80 }, // +30
          { capability: "registry", meterId: "egress", amount: 5 }, // added
        ],
        totals: { expected: 185 },
      },
    );
    render(<EstimateDiff diff={diff} />);
    expect(screen.getByTestId("estimate-diff")).toBeTruthy();
    expect(screen.getByTestId("estimate-diff-total").textContent).toMatch(/\+/);
    expect(screen.getByTestId("diff-s3-get")).toBeTruthy();
    expect(screen.getByTestId("diff-egress")).toBeTruthy();
    // The unchanged meter is not listed.
    expect(screen.queryByTestId("diff-eh-tu")).toBeNull();
  });

  it("EDGE: renders nothing for a no-op diff", () => {
    const same = {
      lineItems: [{ capability: "audit_logs", meterId: "eh-tu", amount: 100 }],
      totals: { expected: 100 },
    };
    render(<EstimateDiff diff={diffEstimates(same, same)} />);
    expect(screen.queryByTestId("estimate-diff")).toBeNull();
  });

  it("EDGE: renders nothing when diff is null", () => {
    render(<EstimateDiff diff={null} />);
    expect(screen.queryByTestId("estimate-diff")).toBeNull();
  });
});
