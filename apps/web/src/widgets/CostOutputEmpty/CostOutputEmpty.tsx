/**
 * Empty Cost output — CTA back to Inputs (no invented $0).
 */
export type CostOutputEmptyProps = {
  onGoToInputs: () => void;
};

export function CostOutputEmpty({ onGoToInputs }: CostOutputEmptyProps) {
  return (
    <div data-testid="cost-output-empty" className="empty-state">
      <p>
        No estimate yet. Enter inputs and run (or leave Auto-update on) to see
        cost output.
      </p>
      <button
        type="button"
        data-testid="cost-empty-go-inputs"
        onClick={onGoToInputs}
      >
        Go to Inputs
      </button>
    </div>
  );
}
