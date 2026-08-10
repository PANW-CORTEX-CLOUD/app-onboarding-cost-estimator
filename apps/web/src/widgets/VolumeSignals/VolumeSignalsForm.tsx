/**
 * Volume signals form — ingress / peaks; no pricing math in the widget.
 * Packages 35 + 01/07: Affects chips with driver sync.
 */
import { AffectsChips } from "../AffectsChips/AffectsChips.tsx";
import type { AffectsChip } from "../../shared/lib/affects-chips.ts";

export type VolumeSignalsFormProps = {
  ingressGBPerDay: number;
  peakMBps: number;
  peakEventsPerSec: number;
  onChange: (patch: {
    ingressGBPerDay?: number;
    peakMBps?: number;
    peakEventsPerSec?: number;
  }) => void;
  affectsIngress?: AffectsChip[];
  affectsPeakMBps?: AffectsChip[];
  affectsPeakEps?: AffectsChip[];
  /** When audit_logs (or matching cap) is focused in Cost Drivers. */
  auditChipsActive?: boolean;
  onAuditChipClick?: () => void;
};

export function VolumeSignalsForm({
  ingressGBPerDay,
  peakMBps,
  peakEventsPerSec,
  onChange,
  affectsIngress = [],
  affectsPeakMBps = [],
  affectsPeakEps = [],
  auditChipsActive = false,
  onAuditChipClick,
}: VolumeSignalsFormProps) {
  return (
    <div data-testid="volume-signals">
      <p className="section-lede">
        Audit stream sizing. Editing locks volume until you unlock under Model
        assumptions.
      </p>
      <label>
        Average ingress (GB / day)
        <input
          type="number"
          min={0}
          value={ingressGBPerDay}
          data-testid="input-ingress"
          onChange={(e) =>
            onChange({ ingressGBPerDay: Number(e.target.value) || 0 })
          }
        />
        <span className="field-hint">
          Typical daily audit log volume into the stream
        </span>
        <AffectsChips
          chips={affectsIngress}
          testId="affects-ingress"
          active={auditChipsActive}
          onChipClick={onAuditChipClick}
        />
      </label>
      <label>
        Peak throughput (MB / s)
        <input
          type="number"
          min={0}
          value={peakMBps}
          data-testid="input-peak-mbps"
          onChange={(e) =>
            onChange({ peakMBps: Number(e.target.value) || 0 })
          }
        />
        <span className="field-hint">
          Sizes capacity units (TUs / shards); does not inflate average GB
        </span>
        <AffectsChips
          chips={affectsPeakMBps}
          testId="affects-peak-mbps"
          active={auditChipsActive}
          onChipClick={onAuditChipClick}
        />
      </label>
      <label>
        Peak events / second
        <input
          type="number"
          min={0}
          value={peakEventsPerSec}
          data-testid="input-peak-eps"
          onChange={(e) =>
            onChange({ peakEventsPerSec: Number(e.target.value) || 0 })
          }
        />
        <span className="field-hint">
          Alternate peak signal for capacity sizing
        </span>
        <AffectsChips
          chips={affectsPeakEps}
          testId="affects-peak-eps"
          active={auditChipsActive}
          onChipClick={onAuditChipClick}
        />
      </label>
    </div>
  );
}
