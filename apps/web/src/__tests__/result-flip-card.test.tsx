/**
 * Package 01/01 — Cost result flip card (drivers ↔ meters).
 */
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RESULT_COST_FACE_SESSION_KEY,
  ResultFlipCard,
  readCostFaceFromSession,
  writeCostFaceToSession,
} from "../widgets/ResultFlipCard/ResultFlipCard.tsx";
import { ResultsCanvas } from "../widgets/ResultsCanvas/ResultsCanvas.tsx";

afterEach(() => {
  cleanup();
  sessionStorage.removeItem(RESULT_COST_FACE_SESSION_KEY);
});

describe("ResultFlipCard", () => {
  beforeEach(() => {
    sessionStorage.removeItem(RESULT_COST_FACE_SESSION_KEY);
  });

  it("defaults to high (drivers); toggle shows meters face", () => {
    render(
      <ResultFlipCard
        high={<div data-testid="cost-drivers">drivers</div>}
        low={<div data-testid="cost-breakdown">meters</div>}
      />,
    );
    expect(screen.getByTestId("result-flip-card")).toHaveAttribute(
      "data-face",
      "high",
    );
    expect(screen.getByTestId("result-flip-face-high")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    fireEvent.click(screen.getByTestId("result-flip-toggle"));
    expect(screen.getByTestId("result-flip-card")).toHaveAttribute(
      "data-face",
      "low",
    );
    expect(screen.getByTestId("result-flip-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("result-flip-face-label")).toHaveTextContent(
      /Meter line items/,
    );
  });

  it("persists face in sessionStorage", () => {
    writeCostFaceToSession("low");
    expect(readCostFaceFromSession()).toBe("low");
    expect(readCostFaceFromSession(() => "bogus")).toBe("high");
  });

  it("EDGE: restores low from session on mount", () => {
    sessionStorage.setItem(RESULT_COST_FACE_SESSION_KEY, "low");
    render(
      <ResultFlipCard
        high={<div>h</div>}
        low={<div data-testid="cost-breakdown">l</div>}
      />,
    );
    expect(screen.getByTestId("result-flip-card")).toHaveAttribute(
      "data-face",
      "low",
    );
  });
});

describe("ResultsCanvas cost tab", () => {
  it("exposes cost tab with aria wiring", () => {
    render(
      <ResultsCanvas activeTab="cost" onTabChange={() => undefined}>
        <div>body</div>
      </ResultsCanvas>,
    );
    const tab = screen.getByTestId("results-tab-cost");
    expect(tab).toHaveAttribute("aria-controls", "results-panel-cost");
    expect(screen.getByTestId("results-panel-cost")).toHaveAttribute(
      "aria-labelledby",
      "results-tab-cost",
    );
  });
});
