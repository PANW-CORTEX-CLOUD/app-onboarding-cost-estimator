/**
 * Primary journey modes — Inputs (enter) vs Cost output (read).
 * Parallel tabs for two jobs; not a wizard (NN/G tabs).
 */
import type { ReactNode } from "react";
import type { JourneyMode } from "../../shared/lib/journey-view.ts";

export type EstimatorJourneyShellProps = {
  mode: JourneyMode;
  onModeChange: (mode: JourneyMode) => void;
  inputs: ReactNode;
  cost: ReactNode;
};

export function EstimatorJourneyShell({
  mode,
  onModeChange,
  inputs,
  cost,
}: EstimatorJourneyShellProps) {
  return (
    <div data-testid="estimator-journey" className="estimator-journey">
      <div
        role="tablist"
        aria-label="Journey"
        className="journey-mode-tabs"
        data-testid="journey-mode-tabs"
      >
        <button
          type="button"
          role="tab"
          id="journey-tab-inputs"
          data-testid="journey-tab-inputs"
          aria-selected={mode === "inputs"}
          aria-controls="journey-panel-inputs"
          className={mode === "inputs" ? "tab-active" : undefined}
          onClick={() => onModeChange("inputs")}
        >
          Inputs
        </button>
        <button
          type="button"
          role="tab"
          id="journey-tab-cost"
          data-testid="journey-tab-cost"
          aria-selected={mode === "cost"}
          aria-controls="journey-panel-cost"
          className={mode === "cost" ? "tab-active" : undefined}
          onClick={() => onModeChange("cost")}
        >
          Cost output
        </button>
      </div>
      <div
        role="tabpanel"
        id="journey-panel-inputs"
        aria-labelledby="journey-tab-inputs"
        data-testid="journey-panel-inputs"
        hidden={mode !== "inputs"}
        className="journey-panel"
      >
        {inputs}
      </div>
      <div
        role="tabpanel"
        id="journey-panel-cost"
        aria-labelledby="journey-tab-cost"
        data-testid="journey-panel-cost"
        hidden={mode !== "cost"}
        className="journey-panel"
      >
        {cost}
      </div>
    </div>
  );
}
