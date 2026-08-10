/**
 * Single source of truth for USD formatting - was reimplemented as a local
 * `usd()` function in 7 separate widgets plus 3 inline calls in
 * EstimatorPage, with precision already silently diverging (most omitted
 * `maximumFractionDigits`, ProjectionCharts forced 0, ProjectionTable
 * forced 2).
 */

/**
 * Format a number as USD via `Intl.NumberFormat`.
 * @param maximumFractionDigits Defaults to 2 (Intl's own default for USD).
 *   Pass 0 for compact whole-dollar display (e.g. chart axis labels).
 */
export function formatUsd(n: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(n);
}
