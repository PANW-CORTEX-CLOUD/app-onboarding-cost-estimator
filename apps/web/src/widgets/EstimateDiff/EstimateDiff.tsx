/**
 * Renders a per-meter estimate diff — "what changed since the last quote".
 * Shows only meters that moved (added / removed / changed); a no-op diff renders
 * nothing so the panel never adds noise to an unchanged re-run.
 */
import type { EstimateDiff as EstimateDiffData } from "../../shared/lib/estimate-diff.ts";
import { isNoOpDiff } from "../../shared/lib/estimate-diff.ts";
import { capabilityLabel } from "../../shared/model/capability-labels.ts";
import { formatUsd as usd } from "../../shared/lib/format-currency.ts";

export type EstimateDiffProps = {
  diff: EstimateDiffData | null;
};

/** Signed currency, e.g. "+$12.50" / "−$3.00", for a delta column. */
function signedUsd(delta: number): string {
  if (delta === 0) return usd(0);
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${usd(Math.abs(delta))}`;
}

export function EstimateDiff({ diff }: EstimateDiffProps) {
  if (!diff || isNoOpDiff(diff)) return null;
  const moved = diff.meters.filter((m) => m.status !== "unchanged");
  if (moved.length === 0) return null;

  return (
    <section data-testid="estimate-diff" aria-label="Changes since last estimate">
      <h3>What changed since your last estimate</h3>
      <p data-testid="estimate-diff-total" className="section-lede">
        Total {signedUsd(diff.totalDelta)} ({usd(diff.totalBefore)} →{" "}
        {usd(diff.totalAfter)})
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Cloud meter</th>
            <th scope="col">Change</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
            <th scope="col">Δ</th>
          </tr>
        </thead>
        <tbody>
          {moved.map((m) => (
            <tr
              key={`${m.capability}/${m.meterId}`}
              data-status={m.status}
              data-testid={`diff-${m.meterId}`}
            >
              <td>{capabilityLabel(m.capability)}</td>
              <td>
                <code className="meter-id">{m.meterId}</code>
              </td>
              <td>{m.status}</td>
              <td>{m.before === null ? "—" : usd(m.before)}</td>
              <td>{m.after === null ? "—" : usd(m.after)}</td>
              <td>{signedUsd(m.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
