/**
 * What the estimator guessed, as opposed to what you told it.
 *
 * This widget used to hardcode four assumptions passed down from the page,
 * which had two problems: a reader could not tell their own inputs from the
 * tool's defaults, and any new default in the engine stayed invisible until
 * somebody remembered to edit this file. The engine now reports every default
 * it substituted, so this renders whatever it is given and cannot drift.
 *
 * Conventions (730 hours in a month) and assumptions (10 accounts) are shown
 * apart on purpose: only the second kind is worth arguing with.
 */
import type { components } from "../../shared/api/generated/openapi.types.ts";

type AppliedDefault = components["schemas"]["AppliedDefault"];

export type ResultsAssumptionsSnapshotProps = {
  /** Defaults the engine substituted for this estimate. */
  appliedDefaults?: AppliedDefault[];
  /** Values the caller supplied; shown so the two are distinguishable. */
  monthHours: number;
  assumedEventBytes: number;
  avgStoredGB: number;
  logIntensity: string;
};

export function ResultsAssumptionsSnapshot({
  appliedDefaults = [],
  monthHours,
  assumedEventBytes,
  avgStoredGB,
  logIntensity,
}: ResultsAssumptionsSnapshotProps) {
  const guesses = appliedDefaults.filter((d) => d.kind === "assumption");

  return (
    <div
      data-testid="results-assumptions-snapshot"
      className="results-assumptions-snapshot"
    >
      <p className="field-hint">
        Sizing used: {monthHours} h/month · {assumedEventBytes} B/event ·{" "}
        {avgStoredGB} GB stored · intensity {logIntensity}
      </p>

      {guesses.length > 0 ? (
        <details data-testid="applied-defaults">
          <summary>
            {guesses.length} value{guesses.length === 1 ? "" : "s"} we guessed
            because you did not supply {guesses.length === 1 ? "it" : "them"}
          </summary>
          <ul className="applied-defaults-list">
            {guesses.map((d) => (
              <li key={d.field} data-testid={`applied-default-${d.field}`}>
                <span className="applied-default-label">
                  {d.label}: <strong>{String(d.value)}</strong>
                </span>
                <span className="field-hint">{d.rationale}</span>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            Each of these changes the total. Supply your own value on the Inputs
            step to replace the guess.
          </p>
        </details>
      ) : (
        <p className="field-hint" data-testid="applied-defaults-none">
          Every sizing input came from you — nothing was guessed.
        </p>
      )}
    </div>
  );
}
