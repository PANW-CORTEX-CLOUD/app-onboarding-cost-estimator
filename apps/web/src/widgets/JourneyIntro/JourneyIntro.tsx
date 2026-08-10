/**
 * Short mode intro above journey tabs (replaces long scroll how-to).
 * Minimized on Cost once an estimate exists so $ stays above the fold.
 */
export type JourneyIntroProps = {
  /** Compact one-liner (Cost with estimate). */
  minimized?: boolean;
};

export function JourneyIntro({ minimized = false }: JourneyIntroProps) {
  if (minimized) {
    return (
      <p
        data-testid="journey-intro"
        className="journey-intro journey-intro--minimized field-hint"
      >
        Cost output — monthly spend and drivers. Switch to Inputs to change
        sizing.
      </p>
    );
  }
  return (
    <div data-testid="journey-intro" className="journey-intro">
      <ul className="journey-intro__bullets">
        <li>
          <strong>Inputs</strong> — enter cloud, capabilities, and size that
          feed the estimate.
        </li>
        <li>
          <strong>Cost output</strong> — monthly spend, what drives it, then
          meters / projections / compare / export on demand.
        </li>
      </ul>
      <p className="field-hint" data-testid="how-to-use-honesty">
        Azure connector TF bills audit stream+store only; other capabilities
        are modeled · no connector TF.
      </p>
    </div>
  );
}
