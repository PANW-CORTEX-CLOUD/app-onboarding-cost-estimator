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
import { formatUsd as usd } from "../../shared/lib/format-currency.ts";

export type CostBreakdownProps = {
  estimate: EstimateResponse | null;
  capabilities?: EstimateCapabilities;
  warnings?: string[];
  breakdownRows?: BreakdownRow[];
  discoveryOnlyEmpty?: boolean;
};

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

  // Explicit BreakdownRow[] annotation: without it, TS infers the fallback
  // branch's object literal as its own narrower type (no placeholder/note
  // keys at all, not even as absent-optional), and the union with
  // BreakdownRow[] then rejects `li.placeholder`/`li.note` access below.
  const rows: BreakdownRow[] =
    rowsProp ??
    (capabilities
      ? buildBreakdownRows(estimate, capabilities, warnings)
      : estimate.lineItems.map<BreakdownRow>((li) => ({
          capability: li.capability,
          meterId: li.meterId,
          amount: li.amount,
          confidence: li.confidence,
          ...(li.verification
            ? {
                verification: {
                  trusted: li.verification.trusted,
                  verdict: li.verification.verdict,
                  sourceUrl: li.verification.sourceUrl,
                },
              }
            : {}),
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
            <th scope="col">Source</th>
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
              <td data-testid={`source-${li.meterId}`}>
                {li.verification ? (
                  li.verification.trusted ? (
                    <a
                      className="verify-badge verify-badge--trusted"
                      href={li.verification.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Vendor-backed rate — verified against ${li.verification.sourceUrl}`}
                    >
                      ✓ verified
                    </a>
                  ) : (
                    <span
                      className="verify-badge verify-badge--untrusted"
                      title={`Not vendor-backed (${li.verification.verdict}) — treat as indicative`}
                    >
                      ⚠ {li.verification.verdict}
                    </span>
                  )
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="muted">{li.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
