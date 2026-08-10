/**
 * Cost driver breakdown — share of monthly expected by capability.
 * Packages 34 + 01–02/07: why panel, TF badges, focus sync, sensitivity delta.
 */
import type { EstimateResponse } from "../../entities/estimate/types.ts";
import type { CloudProvider } from "../../shared/model/cloud-provider.ts";
import {
  aggregateCostDrivers,
  type CostDriverRow,
} from "../../shared/lib/cost-drivers.ts";
import {
  explainDriver,
  jumpToInputTestId,
  metersForCapability,
} from "../../shared/lib/cost-driver-explain.ts";
import type { BreakdownRow } from "../../shared/lib/capability-breakdown.ts";
import { capabilityLabel } from "../../shared/model/capability-labels.ts";
import {
  tfGroundingForCapability,
  tfGroundingLabel,
} from "../../shared/model/tf-grounding.ts";
import { formatUsd as usd } from "../../shared/lib/format-currency.ts";

export type CostDriversProps = {
  estimate: EstimateResponse | null;
  breakdownRows?: BreakdownRow[];
  discoveryOnlyEmpty?: boolean;
  /** Called before focusing an input — parent should switch Inputs step. */
  onJumpToInput?: (inputTestId: string) => void;
  onApplyPeakMinus20?: () => void;
  onApplyPeakPlus1?: () => void;
  /** Capability currently focused for chip sync. */
  activeCapability?: string | null;
  onDriverFocus?: (capability: string | null) => void;
  /** Force-open why panel for this capability (chip click). */
  openWhyCapability?: string | null;
  previousExpected?: number | null;
  /** True while a post-sensitivity re-estimate is in flight. */
  sensitivityUpdating?: boolean;
};

export function CostDrivers({
  estimate,
  breakdownRows,
  discoveryOnlyEmpty = false,
  onJumpToInput,
  onApplyPeakMinus20,
  onApplyPeakPlus1,
  activeCapability = null,
  onDriverFocus,
  openWhyCapability = null,
  previousExpected = null,
  sensitivityUpdating = false,
}: CostDriversProps) {
  if (discoveryOnlyEmpty) {
    return (
      <p data-testid="discovery-only-empty" className="empty-state">
        Discovery-only — no billable cost drivers. Enable Audit logs or another
        capability to see what drives the bill.
      </p>
    );
  }
  if (!estimate) {
    return (
      <p data-testid="cost-drivers-empty" className="empty-state">
        No estimate yet. Use <strong>Go to Inputs</strong> above, then Run
        estimate when ready.
      </p>
    );
  }

  const provider = estimate.provider as CloudProvider;
  const source =
    breakdownRows?.map((r) => ({
      capability: r.capability,
      amount: r.amount,
      confidence: r.confidence,
    })) ?? undefined;
  const drivers = aggregateCostDrivers(estimate, source);
  const max = Math.max(...drivers.map((d) => d.amount), 0.01);
  const topCapability = drivers[0]?.capability;

  return (
    <div data-testid="cost-drivers">
      <p className="section-lede">
        Share of <strong>{usd(estimate.totals.expected)} / month</strong>. Expand
        a row for meters, formula, and which inputs move that cost.
      </p>
      <ul className="cost-driver-bars" aria-label="Cost drivers by capability">
        {drivers.map((d) => {
          const meters = metersForCapability(estimate.lineItems, d.capability);
          const explain = explainDriver(provider, d.capability);
          const isTop = d.capability === topCapability;
          const grounding = tfGroundingForCapability(provider, d.capability);
          const active = activeCapability === d.capability;
          const whyOpen =
            openWhyCapability === d.capability || active;
          return (
            <li
              key={d.capability}
              data-testid={`driver-${d.capability}`}
              data-active={active ? "true" : undefined}
              className={active ? "driver-active" : undefined}
            >
              <div className="cost-driver-label">
                <span>
                  <span className="cap-toggle-title">
                    {capabilityLabel(d.capability)}
                  </span>
                  <span
                    className="tf-grounding-badge"
                    data-testid={`driver-badge-${d.capability}`}
                    data-grounding={grounding}
                  >
                    {tfGroundingLabel(grounding)}
                  </span>
                  <span className="field-hint mono">{d.capability}</span>
                </span>
                <span>
                  {usd(d.amount)} · {d.percent.toFixed(1)}% ·{" "}
                  <span data-confidence={d.confidence}>{d.confidence}</span>
                </span>
              </div>
              <div className="cost-driver-track" role="presentation">
                <div
                  className="cost-driver-bar"
                  style={{ width: `${(d.amount / max) * 100}%` }}
                />
              </div>
              <details
                className="cost-driver-why"
                data-testid={`driver-why-${d.capability}`}
                open={whyOpen || undefined}
                onToggle={(e) => {
                  const el = e.currentTarget;
                  if (el.open) onDriverFocus?.(d.capability);
                  else if (active) onDriverFocus?.(null);
                }}
              >
                <summary>Why this cost</summary>
                <p
                  className="field-hint"
                  data-testid={`driver-formula-${d.capability}`}
                >
                  {explain.formula}
                </p>
                <p className="field-hint">Meters in this estimate:</p>
                <ul data-testid={`driver-meters-${d.capability}`}>
                  {meters.length === 0 ? (
                    <li className="muted">No meter lines (placeholder / $0)</li>
                  ) : (
                    meters.map((m) => (
                      <li key={m.meterId}>
                        <code className="meter-id">{m.meterId}</code>
                        {" · "}
                        {usd(m.amount)} · {m.confidence}
                      </li>
                    ))
                  )}
                </ul>
                {explain.inputLinks.length > 0 ? (
                  <div className="driver-input-links">
                    <p className="field-hint">Inputs that feed this driver:</p>
                    <ul>
                      {explain.inputLinks.map((link) => (
                        <li key={link.inputTestId}>
                          <button
                            type="button"
                            className="linkish"
                            data-testid={`jump-${d.capability}-${link.inputTestId}`}
                            onClick={() => {
                              onDriverFocus?.(d.capability);
                              if (onJumpToInput) {
                                onJumpToInput(link.inputTestId);
                              } else {
                                jumpToInputTestId(link.inputTestId);
                              }
                            }}
                          >
                            Jump to {link.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {isTop ? (
                  <div
                    className="driver-sensitivity"
                    data-testid={`driver-sensitivity-${d.capability}`}
                  >
                    {explain.peakNudge ? (
                      <p className="field-hint">{explain.peakNudge}</p>
                    ) : null}
                    <div className="driver-sensitivity-actions">
                      {onApplyPeakMinus20 ? (
                        <button
                          type="button"
                          data-testid="apply-peak-minus-20"
                          onClick={onApplyPeakMinus20}
                        >
                          Apply −20% to peak MB/s
                        </button>
                      ) : null}
                      {onApplyPeakPlus1 ? (
                        <button
                          type="button"
                          data-testid="apply-peak-plus-1"
                          onClick={onApplyPeakPlus1}
                        >
                          +1 peak MB/s (capacity step)
                        </button>
                      ) : null}
                    </div>
                    {sensitivityUpdating ? (
                      <p
                        className="field-hint"
                        data-testid="sensitivity-updating"
                      >
                        Updating…
                      </p>
                    ) : previousExpected != null &&
                      previousExpected !== estimate.totals.expected ? (
                      <p
                        className="field-hint"
                        data-testid="sensitivity-delta"
                      >
                        Was {usd(previousExpected)} → now{" "}
                        {usd(estimate.totals.expected)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>
      <details
        className="cost-driver-table-details"
        data-testid="drivers-share-table"
      >
        <summary>Numeric share table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">Amount</th>
              <th scope="col">Share</th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d: CostDriverRow) => (
              <tr key={d.capability}>
                <td>{capabilityLabel(d.capability)}</td>
                <td>{usd(d.amount)}</td>
                <td>{d.percent.toFixed(1)}%</td>
                <td>{d.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
