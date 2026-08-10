/**
 * Results summary — slim headline ($ / freshness / auto-chip).
 * Bands, confidence, and rates provenance live in Cost grounding details (progressive disclosure).
 */
import {
  PROVIDER_LABELS,
  type CloudProvider,
} from "../../entities/provider/model.ts";
import type { FreshnessLevel } from "../../entities/rates/types.ts";
import { formatUsd as usd } from "../../shared/lib/format-currency.ts";

export type ResultsSummaryProps = {
  provider: CloudProvider;
  region: string;
  monthlyExpected: number | null;
  monthlyLow?: number | null;
  monthlyHigh?: number | null;
  confidence?: string | null;
  freshnessLevel: FreshnessLevel | null;
  freshnessLabel: string | null;
  ratesSource?: string | null;
  ratesAsOf?: string | null;
  autoRunEnabled?: boolean;
  loading?: boolean;
  offlineEngine?: boolean;
  onAutoUpdateChipClick?: () => void;
  /**
   * When true, hide bands/confidence/provenance here —
   * they belong in results-grounding details (Cost journey).
   */
  slim?: boolean;
};

export function ResultsSummary({
  provider,
  region,
  monthlyExpected,
  monthlyLow = null,
  monthlyHigh = null,
  confidence = null,
  freshnessLevel,
  freshnessLabel,
  ratesSource = null,
  ratesAsOf = null,
  autoRunEnabled = true,
  loading = false,
  offlineEngine = false,
  onAutoUpdateChipClick,
  slim = false,
}: ResultsSummaryProps) {
  const hasEstimate = monthlyExpected != null;
  const provenanceRatesAsOf = ratesAsOf?.trim() ? ratesAsOf : "n/a";

  return (
    <header data-testid="results-summary" aria-label="Estimate summary">
      <p data-testid="summary-provider">
        Provider: {PROVIDER_LABELS[provider]} · Region: {region}
      </p>
      <p data-testid="summary-monthly-expected">
        <span className="summary-expected-label">Estimated cloud spend / month</span>
        {monthlyExpected == null ? "—" : usd(monthlyExpected)}
      </p>
      {!slim && hasEstimate ? (
        <p data-testid="summary-provenance" className="summary-provenance">
          {region} · {ratesSource ?? "n/a"} · ratesAsOf {provenanceRatesAsOf}
        </p>
      ) : null}
      {!slim ? (
        <div className="summary-meta">
          {monthlyLow != null && monthlyHigh != null ? (
            <p data-testid="summary-bands">
              Range (low → high): {usd(monthlyLow)} →{" "}
              {monthlyExpected == null ? "—" : usd(monthlyExpected)} →{" "}
              {usd(monthlyHigh)}
            </p>
          ) : null}
          {confidence ? (
            <p data-testid="summary-confidence">
              Confidence: <strong>{confidence}</strong>
              {confidence === "Low"
                ? " — treat bands as indicative; check Low rows in Breakdown"
                : confidence === "Med"
                  ? " — mix of published rates and modeled volume"
                  : " — rates and formulas are well-bound"}
            </p>
          ) : null}
        </div>
      ) : null}
      <p
        data-testid="freshness-chip"
        data-freshness={freshnessLevel ?? "unknown"}
      >
        Freshness: {freshnessLabel ?? "n/a"}
      </p>
      <button
        type="button"
        className="auto-update-chip"
        data-testid="auto-update-status-chip"
        data-state={
          loading ? "updating" : autoRunEnabled ? "on" : "off"
        }
        onClick={onAutoUpdateChipClick}
      >
        {loading
          ? "Updating…"
          : offlineEngine
            ? "Offline · cached only"
            : autoRunEnabled
              ? "Auto-update on"
              : "Auto-update off"}
      </button>
    </header>
  );
}
