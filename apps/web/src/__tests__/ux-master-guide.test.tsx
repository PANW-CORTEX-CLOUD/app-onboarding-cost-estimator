/**
 * [TEST] Warning humanization + ESTIMATOR_UI_FLOW SSOT.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { humanizeEstimateWarning } from "../shared/lib/humanize-warnings.ts";
import { EstimateWarningsList } from "../widgets/EstimateWarningsList/EstimateWarningsList.tsx";
import { CompareScenarios } from "../widgets/CompareScenarios/CompareScenarios.tsx";
import { inputsStepForJumpTarget } from "../shared/lib/journey-view.ts";

describe("UX master — warnings + flow doc + compare empty", () => {
  it("[TEST] ESTIMATOR_UI_FLOW.md exists and omits view-cost-output", () => {
    const path = resolve(
      __dirname,
      "../../../../docs/ESTIMATOR_UI_FLOW.md",
    );
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toMatch(/Run estimate/);
    expect(body).toMatch(/view-cost-output/);
    expect(body).toMatch(/removed/i);
    // Inventory must not recommend keeping the button as a primary control.
    expect(body).not.toMatch(/Press `view-cost-output`/);
  });

  it("[TEST] humanize maps 429/fallback to SE-facing summary", () => {
    const a = humanizeEstimateWarning("HTTP 429; using fallback rates");
    expect(a.summary).toMatch(/rate-limited|fallback/i);
    expect(a.summary).not.toMatch(/^HTTP 429/);
    expect(a.detail).toMatch(/429/);

    const b = humanizeEstimateWarning("avgGB=0 floor applied");
    expect(b.summary).toMatch(/storage floor/i);
    expect(b.detail).toBeTruthy();
  });

  it("[TEST] EstimateWarningsList shows summary not sole raw 429", () => {
    render(
      <EstimateWarningsList
        warnings={["HTTP 429; using fallback for azure"]}
      />,
    );
    expect(screen.getByTestId("estimate-warning-summary").textContent).toMatch(
      /rate-limited|fallback/i,
    );
    expect(
      screen.getByTestId("estimate-warning-summary").textContent,
    ).not.toMatch(/^HTTP 429/);
    expect(screen.getByTestId("estimate-warning-detail").textContent).toMatch(
      /429/,
    );
  });

  it("[TEST] Compare empty state before side-by-side run", () => {
    render(
      <CompareScenarios
        mode="providers"
        onModeChange={() => {}}
        columns={[]}
        onRunCompare={() => {}}
      />,
    );
    expect(screen.getByTestId("compare-empty")).toHaveTextContent(
      /Run side-by-side compare/,
    );
  });

  it("[EDGE] jump target maps peak → size, avg-stored → run", () => {
    expect(inputsStepForJumpTarget("input-peak-mbps")).toBe("size");
    expect(inputsStepForJumpTarget("input-avg-stored-gb")).toBe("run");
    expect(inputsStepForJumpTarget("cap-toggle-auditLogs")).toBe("start");
  });
});
