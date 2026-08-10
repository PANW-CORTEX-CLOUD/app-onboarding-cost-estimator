/**
 * Package 27 — CostDrivers widget RTL.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostDrivers } from "../widgets/CostDrivers/CostDrivers.tsx";

describe("CostDrivers", () => {
  it("renders bars for multi-cap fixture", () => {
    render(
      <CostDrivers
        estimate={{
          provider: "azure",
          lineItems: [
            {
              provider: "azure",
              capability: "audit_logs",
              meterId: "a",
              amount: 80,
              confidence: "High",
            },
            {
              provider: "azure",
              capability: "dspm",
              meterId: "b",
              amount: 20,
              confidence: "Low",
            },
          ],
          totals: { expected: 100 },
          confidence: "Low",
          modelVersion: "0.1.2",
          ratesAsOf: "2026-07-01",
          inputHash: "x",
        }}
      />,
    );
    expect(screen.getByTestId("cost-drivers")).toBeInTheDocument();
    expect(screen.getByTestId("driver-audit_logs")).toBeInTheDocument();
    expect(screen.getByTestId("driver-dspm")).toBeInTheDocument();
  });
});
