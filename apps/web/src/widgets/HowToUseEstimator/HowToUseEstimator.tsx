/**
 * How-to-use band — three steps + TF honesty one-liner (full-page IA).
 * Static orientation only; no pricing math.
 */
export function HowToUseEstimator() {
  return (
    <div data-testid="how-to-use-content" className="how-to-use">
      <ol className="how-to-use__steps">
        <li>
          <strong>Start</strong> — pick a{" "}
          <a href="#provider-region">Quick-start preset</a> (Azure · audit-only
          is TF-faithful) or set provider, region, and capability toggles.
        </li>
        <li>
          <strong>Size</strong> — set estate and volume; leave advanced
          assumptions collapsed unless you need them.
        </li>
        <li>
          <strong>Read</strong> —{" "}
          <a href="#rates-freshness">Run</a> once (or leave Auto-update on),
          then open{" "}
          <a href="#results-summary">Read the estimate</a>: Cost = drivers →
          flip for meters; Projections = forward months; Compare = providers /
          tiers.
        </li>
      </ol>
      <p className="field-hint" data-testid="how-to-use-honesty">
        Azure connector TF bills audit stream+store only; other capabilities
        are modeled · no connector TF.
      </p>
    </div>
  );
}
