/**
 * Non-honesty estimate warnings — rate/volume/ADS notes not in TF honesty banner.
 * Human summary first; raw technical detail in optional disclosure.
 */
import { isHonestyWarning } from "../EstimateHonestyBanner/EstimateHonestyBanner.tsx";
import { humanizeEstimateWarning } from "../../shared/lib/humanize-warnings.ts";

export type EstimateWarningsListProps = {
  warnings: string[];
  /** Freshness banner message — omit duplicates. */
  freshnessMessage?: string | null;
};

export function filterNonHonestyWarnings(
  warnings: string[],
  freshnessMessage?: string | null,
): string[] {
  const fresh = freshnessMessage?.trim() ?? "";
  return warnings.filter((w) => {
    if (isHonestyWarning(w)) return false;
    if (fresh && w.trim() === fresh) return false;
    return true;
  });
}

export function EstimateWarningsList({
  warnings,
  freshnessMessage = null,
}: EstimateWarningsListProps) {
  const items = filterNonHonestyWarnings(warnings, freshnessMessage);
  if (items.length === 0) return null;
  return (
    <aside
      data-testid="estimate-warnings"
      className="estimate-warnings"
      aria-label="Estimate warnings"
    >
      <p className="field-hint">Other estimate notes</p>
      <ul>
        {items.map((w) => {
          const { summary, detail } = humanizeEstimateWarning(w);
          return (
            <li key={w} data-testid="estimate-warning-item">
              <span data-testid="estimate-warning-summary">{summary}</span>
              {detail ? (
                <details className="warning-tech-detail">
                  <summary>Technical detail</summary>
                  <code data-testid="estimate-warning-detail">{detail}</code>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
