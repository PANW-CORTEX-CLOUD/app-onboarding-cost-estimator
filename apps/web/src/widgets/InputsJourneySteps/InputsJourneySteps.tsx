/**
 * Inputs wizard steps — Start → Size → Assumptions & run.
 * Keep all panels mounted; hide inactive so form state / auto-run survive.
 * Continue is hidden on the last step (Run is the primary CTA there).
 */
import type { ReactNode } from "react";
import type { InputsJourneyStep } from "../../shared/lib/journey-view.ts";

const STEPS: { id: InputsJourneyStep; label: string }[] = [
  { id: "start", label: "Start" },
  { id: "size", label: "Size" },
  { id: "run", label: "Assumptions & run" },
];

export type InputsJourneyStepsProps = {
  step: InputsJourneyStep;
  onStepChange: (step: InputsJourneyStep) => void;
  /** Optional checklist (missing fields). */
  checklist?: ReactNode;
  start: ReactNode;
  size: ReactNode;
  run: ReactNode;
};

export function InputsJourneySteps({
  step,
  onStepChange,
  checklist,
  start,
  size,
  run,
}: InputsJourneyStepsProps) {
  const idx = STEPS.findIndex((s) => s.id === step);
  const n = Math.max(0, idx) + 1;
  const isLast = idx >= STEPS.length - 1;

  function go(delta: number) {
    const next = STEPS[idx + delta];
    if (next) onStepChange(next.id);
  }

  return (
    <div data-testid="inputs-journey-steps" className="inputs-journey-steps">
      <p className="journey-step-progress" data-testid="journey-step-progress">
        Step {n} of {STEPS.length}
      </p>
      <div
        role="tablist"
        aria-label="Input steps"
        className="journey-step-tabs"
        data-testid="journey-step-tabs"
      >
        {STEPS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            data-testid={`journey-step-tab-${s.id}`}
            aria-selected={step === s.id}
            className={step === s.id ? "tab-active" : undefined}
            onClick={() => onStepChange(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {checklist}
      <div
        data-testid="journey-step-panel-start"
        hidden={step !== "start"}
        aria-hidden={step !== "start"}
        className="journey-step-panel"
      >
        {start}
      </div>
      <div
        data-testid="journey-step-panel-size"
        hidden={step !== "size"}
        aria-hidden={step !== "size"}
        className="journey-step-panel"
      >
        {size}
      </div>
      <div
        data-testid="journey-step-panel-run"
        hidden={step !== "run"}
        aria-hidden={step !== "run"}
        className="journey-step-panel"
      >
        {run}
      </div>
      <div className="journey-step-nav" data-testid="journey-step-nav">
        <button
          type="button"
          data-testid="journey-step-back"
          disabled={idx <= 0}
          onClick={() => go(-1)}
        >
          Back
        </button>
        {!isLast ? (
          <button
            type="button"
            data-testid="journey-step-continue"
            className="journey-step-continue-primary"
            onClick={() => go(1)}
          >
            Continue
          </button>
        ) : null}
      </div>
    </div>
  );
}
