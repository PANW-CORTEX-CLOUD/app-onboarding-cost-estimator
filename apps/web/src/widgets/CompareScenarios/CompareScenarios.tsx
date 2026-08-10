/**
 * Side-by-side scenario compare — providers OR capability tiers.
 * Package 08/08: confidence + low/high bands when present.
 */
import { compareDelta } from "../../shared/lib/share-state.ts";
import type { CloudProvider } from "../../entities/provider/model.ts";
import { PROVIDER_LABELS } from "../../entities/provider/model.ts";
import { modeledCapsList } from "../../shared/model/tf-grounding.ts";

export type CompareColumn = {
  id: string;
  label: string;
  provider: CloudProvider;
  expected: number | null;
  low?: number | null;
  high?: number | null;
  confidence?: string | null;
  loading?: boolean;
  error?: string | null;
  literacyNote?: string | null;
};

export type CompareScenariosProps = {
  mode: "providers" | "tiers";
  onModeChange: (mode: "providers" | "tiers") => void;
  columns: CompareColumn[];
  onRunCompare: () => void;
  running?: boolean;
};

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function tierLiteracyNote(
  provider: CloudProvider,
  tierId: string,
): string {
  if (provider !== "azure") {
    return "No connector TF inventory";
  }
  if (tierId === "foundational") {
    return "TF-faithful (audit stream + store)";
  }
  return `Modeled: ${modeledCapsList().join(", ")}`;
}

export function CompareScenarios({
  mode,
  onModeChange,
  columns,
  onRunCompare,
  running = false,
}: CompareScenariosProps) {
  const base = columns[0]?.expected;
  return (
    <div data-testid="compare-scenarios">
      <fieldset>
        <legend>Compare mode</legend>
        <label>
          <input
            type="radio"
            name="compare-mode"
            checked={mode === "providers"}
            data-testid="compare-mode-providers"
            aria-label="Compare Azure versus AWS versus GCP"
            onChange={() => onModeChange("providers")}
          />{" "}
          Azure vs AWS vs GCP
        </label>
        <label>
          <input
            type="radio"
            name="compare-mode"
            checked={mode === "tiers"}
            data-testid="compare-mode-tiers"
            aria-label="Compare Foundational versus Comprehensive tiers"
            onChange={() => onModeChange("tiers")}
          />{" "}
          Foundational vs Comprehensive
        </label>
      </fieldset>
      <button
        type="button"
        data-testid="run-compare"
        disabled={running}
        onClick={onRunCompare}
      >
        {running ? "Comparing…" : "Run side-by-side compare"}
      </button>
      {columns.length === 0 ||
      columns.every((c) => c.expected == null && !c.loading && !c.error) ? (
        <p
          className="empty-state field-hint"
          data-testid="compare-empty"
        >
          Run side-by-side compare to fill this table.
        </p>
      ) : null}
      <table data-testid="compare-table">
        <thead>
          <tr>
            <th scope="col">Scenario</th>
            <th scope="col">Provider</th>
            <th scope="col">Expected</th>
            <th scope="col">Range</th>
            <th scope="col">Confidence</th>
            <th scope="col">Δ abs</th>
            <th scope="col">Δ %</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col, i) => {
            const delta =
              i === 0 || base == null || col.expected == null
                ? null
                : compareDelta(base, col.expected);
            const hasBands = col.low != null && col.high != null;
            return (
              <tr key={col.id} data-testid={`compare-row-${col.id}`}>
                <td>
                  {col.label}
                  {col.literacyNote ? (
                    <p
                      className="compare-literacy field-hint"
                      data-testid={`compare-literacy-${col.id}`}
                    >
                      {col.literacyNote}
                    </p>
                  ) : null}
                </td>
                <td>{PROVIDER_LABELS[col.provider]}</td>
                <td data-testid={`compare-expected-${col.id}`}>
                  {col.loading
                    ? "…"
                    : col.error
                      ? "error"
                      : col.expected == null
                        ? "—"
                        : usd(col.expected)}
                </td>
                <td data-testid={`compare-range-${col.id}`}>
                  {col.loading || col.error
                    ? "—"
                    : hasBands
                      ? `${usd(col.low!)} → ${usd(col.high!)}`
                      : "—"}
                </td>
                <td data-testid={`compare-confidence-${col.id}`}>
                  {col.loading || col.error
                    ? "—"
                    : (col.confidence ?? "—")}
                </td>
                <td data-testid={`compare-abs-${col.id}`}>
                  {delta ? usd(delta.absolute) : "—"}
                </td>
                <td data-testid={`compare-pct-${col.id}`}>
                  {delta?.percent == null
                    ? "—"
                    : `${delta.percent.toFixed(1)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
