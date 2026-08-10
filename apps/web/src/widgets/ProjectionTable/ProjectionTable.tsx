/**
 * Projection table — a11y alternative with same numbers as charts (AC/TEST).
 */
import type { components } from "../../shared/api/generated/openapi.types.ts";
import { formatUsd as usd } from "../../shared/lib/format-currency.ts";

type ProjectionPoint = components["schemas"]["ProjectionPoint"];

export type ProjectionTableProps = {
  series: ProjectionPoint[] | null;
  provider?: string;
};

export function ProjectionTable({ series, provider }: ProjectionTableProps) {
  if (!series || series.length === 0) {
    return (
      <p data-testid="projection-table-empty">
        No projection until estimate runs.
      </p>
    );
  }
  return (
    <table
      data-testid="projection-table"
      aria-label="Projection table"
    >
      <thead>
        <tr>
          <th scope="col">Month</th>
          <th scope="col">Expected</th>
          <th scope="col">Cumulative</th>
          <th scope="col">Volume index</th>
          {series.some((p) => p.low != null) ? (
            <>
              <th scope="col">Low</th>
              <th scope="col">High</th>
            </>
          ) : null}
          <th scope="col">Provider</th>
        </tr>
      </thead>
      <tbody>
        {series.map((r) => (
          <tr key={r.month} data-month={r.month}>
            <td>{r.month}</td>
            <td data-testid={`proj-expected-${r.month}`}>{usd(r.expected)}</td>
            <td data-testid={`proj-cumulative-${r.month}`}>
              {usd(r.cumulative)}
            </td>
            <td>{r.volumeIndex.toFixed(3)}</td>
            {r.low != null && r.high != null ? (
              <>
                <td>{usd(r.low)}</td>
                <td>{usd(r.high)}</td>
              </>
            ) : series.some((p) => p.low != null) ? (
              <>
                <td>—</td>
                <td>—</td>
              </>
            ) : null}
            <td>{provider ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
