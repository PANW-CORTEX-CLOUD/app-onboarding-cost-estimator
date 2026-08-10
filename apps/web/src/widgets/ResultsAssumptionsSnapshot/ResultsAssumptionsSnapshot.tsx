/**
 * Compact read-only assumptions used for the current estimate (package 08/08).
 */
export type ResultsAssumptionsSnapshotProps = {
  monthHours: number;
  assumedEventBytes: number;
  avgStoredGB: number;
  logIntensity: string;
};

export function ResultsAssumptionsSnapshot({
  monthHours,
  assumedEventBytes,
  avgStoredGB,
  logIntensity,
}: ResultsAssumptionsSnapshotProps) {
  return (
    <p
      data-testid="results-assumptions-snapshot"
      className="results-assumptions-snapshot field-hint"
    >
      Assumptions: {monthHours} h/month · {assumedEventBytes} B/event ·{" "}
      {avgStoredGB} GB stored · intensity {logIntensity}
    </p>
  );
}
