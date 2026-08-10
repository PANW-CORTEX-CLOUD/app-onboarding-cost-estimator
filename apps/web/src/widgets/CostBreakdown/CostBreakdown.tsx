/**
 * CostBreakdown — line items with confidence always visible (never hide Low).
 * Package 26: show every enabled capability (placeholders for $0 / missing meters).
 */
import type { EstimateCapabilities } from "../../entities/estimate/types.ts";
import type { EstimateResponse } from "../../entities/estimate/types.ts";
import {
  buildBreakdownRows,
  type BreakdownRow,
} from "../../shared/lib/capability-breakdown.ts";
import { capabilityLabel } from "../../shared/model/capability-labels.ts";

export type CostBreakdownProps = {
  estimate: EstimateResponse | null;
  capabilities?: EstimateCapabilities;
  warnings?: string[];
  breakdownRows?: BreakdownRow[];
  discoveryOnlyEmpty?: boolean;
};

function usd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function CostBreakdown({
  estimate,
  capabilities,
  warnings = [],
  breakdownRows: rowsProp,
  discoveryOnlyEmpty = false,
}: CostBreakdownProps) {
  if (discoveryOnlyEmpty) {
    return (
      <p data-testid="discovery-only-empty" className="empty-state">
        Discovery-only scope has no billable infrastructure meters ($0). Enable
        Audit logs or another capability to see a cost breakdown.
      </p>
    );
  }
  if (!estimate) {
    return (
      <p data-testid="cost-breakdown-empty" className="empty-state">
        No estimate yet. Run an estimate or apply a demo preset first.
      </p>
    );
  }

  const rows =
    rowsProp ??
    (capabilities
      ? buildBreakdownRows(estimate, capabilities, warnings)
      : estimate.lineItems.map((li) => ({
          capability: li.capability,
          meterId: li.meterId,
          amount: li.amount,
          confidence: li.confidence,
        })));

  return (
    <div data-testid="cost-breakdown">
      <p className="section-lede">
        One row per cloud meter. Placeholder rows ($0 + note) mean a capability
        is enabled but produced no billable line for the current volume.
      </p>
      <p data-testid="cost-expected" hidden>
        Expected monthly: {usd(estimate.totals.expected)}
      </p>
      {estimate.totals.low != null && estimate.totals.high != null ? (
        <p data-testid="breakdown-bands">
          Uncertainty band (low / expected / high): {usd(estimate.totals.low)} /{" "}
          {usd(estimate.totals.expected)} / {usd(estimate.totals.high)}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Cloud meter</th>
            <th scope="col">Monthly $</th>
            <th scope="col">Confidence</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((li) => (
            <tr
              key={`${li.capability}-${li.meterId}-${li.placeholder ? "ph" : "li"}`}
              data-confidence={li.confidence}
              data-placeholder={li.placeholder ? "true" : undefined}
            >
              <td>
                <span className="cap-toggle-title">
                  {capabilityLabel(li.capability)}
                </span>
                <span className="field-hint mono">{li.capability}</span>
              </td>
              <td>
                <code className="meter-id">{li.meterId}</code>
              </td>
              <td>{usd(li.amount)}</td>
              <td data-testid={`confidence-${li.meterId}`}>{li.confidence}</td>
              <td className="muted">{li.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
