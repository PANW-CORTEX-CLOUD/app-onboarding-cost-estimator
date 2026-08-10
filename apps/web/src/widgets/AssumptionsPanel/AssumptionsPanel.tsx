/**
 * Model assumptions — editable algorithm parameters (package 28).
 * Formulas stay in cost-engine; UI sends OpenAPI fields only.
 */
import { AffectsChips } from "../AffectsChips/AffectsChips.tsx";
import type { AffectsChip } from "../../shared/lib/affects-chips.ts";

export type AssumptionsPanelProps = {
  monthHours: number;
  assumedEventBytes: number;
  avgStoredGB: number;
  logIntensity: "low" | "medium" | "high";
  overrideStreamMetrics: boolean;
  onMonthHours: (n: number) => void;
  onAssumedEventBytes: (n: number) => void;
  onAvgStoredGB: (n: number) => void;
  onLogIntensity: (v: "low" | "medium" | "high") => void;
  onOverrideStreamMetrics: (v: boolean) => void;
  affectsAvgStored?: AffectsChip[];
  auditChipsActive?: boolean;
  onAuditChipClick?: () => void;
};

export function AssumptionsPanel({
  monthHours,
  assumedEventBytes,
  avgStoredGB,
  logIntensity,
  overrideStreamMetrics,
  onMonthHours,
  onAssumedEventBytes,
  onAvgStoredGB,
  onLogIntensity,
  onOverrideStreamMetrics,
  affectsAvgStored = [],
  auditChipsActive = false,
  onAuditChipClick,
}: AssumptionsPanelProps) {
  return (
    <div data-testid="assumptions-panel">
      <p className="section-lede">
        These knobs change the math. Edits re-run after a short pause.
      </p>
      <label>
        Hours in a billing month
        <input
          type="number"
          min={1}
          data-testid="input-month-hours"
          value={monthHours}
          onChange={(e) => onMonthHours(Number(e.target.value) || 730)}
        />
        <span className="field-hint">
          Default 730 (~30.4 days). Scales hourly capacity charges.
        </span>
      </label>
      <label>
        Assumed audit event size (bytes)
        <input
          type="number"
          min={1}
          data-testid="input-assumed-event-bytes"
          value={assumedEventBytes}
          onChange={(e) => onAssumedEventBytes(Number(e.target.value) || 1024)}
        />
        <span className="field-hint">
          Converts GB → event count for Azure Event Hubs ingress. Larger events
          ⇒ fewer billed events for the same GB.
        </span>
      </label>
      <label>
        Audit log storage (average GB retained)
        <input
          type="number"
          min={0}
          data-testid="input-avg-stored-gb"
          value={avgStoredGB}
          onChange={(e) => onAvgStoredGB(Number(e.target.value) || 0)}
        />
        <span className="field-hint">
          Optional override for hot storage floor. Leave 0 to use the model
          default from ingress.
        </span>
        <AffectsChips
          chips={affectsAvgStored}
          testId="affects-avg-stored"
          active={auditChipsActive}
          onChipClick={onAuditChipClick}
        />
      </label>
      <label>
        Log intensity
        <select
          data-testid="input-log-intensity"
          value={logIntensity}
          onChange={(e) =>
            onLogIntensity(e.target.value as "low" | "medium" | "high")
          }
        >
          <option value="low">Low — quieter estate</option>
          <option value="medium">Medium — typical</option>
          <option value="high">High — chatty workloads</option>
        </select>
        <span className="field-hint">
          Adjusts volume derived from account count when stream lock is off
        </span>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={overrideStreamMetrics}
          data-testid="input-lock-stream-volume"
          onChange={(e) => onOverrideStreamMetrics(e.target.checked)}
        />
        <span>
          <span className="cap-toggle-title">
            Use the ingress / peak numbers above as-is
          </span>
          <span className="field-hint">
            When off, stream volume is derived from account count + MAU
            (recommended for “how big is my estate?” questions).
          </span>
        </span>
      </label>
      <details className="assumptions-footnotes">
        <summary>Fixed bindings (not editable here)</summary>
        <ul>
          <li>Azure Event Hubs: TU sizing, 84 GB included per TU / month</li>
          <li>AWS Kinesis: shard sizing, 25 KB PUT payload units</li>
          <li>See docs/CLOUD_COST_MODEL.md in the repo for formulas</li>
        </ul>
      </details>
    </div>
  );
}
