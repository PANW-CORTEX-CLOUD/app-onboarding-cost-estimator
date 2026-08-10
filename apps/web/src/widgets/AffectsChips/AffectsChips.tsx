/**
 * Compact live binding from a volume field to estimate meters.
 * Package 01/07: clickable chips sync focus with Cost Drivers.
 */
import {
  formatAffectsChip,
  type AffectsChip,
} from "../../shared/lib/affects-chips.ts";

export type AffectsChipsProps = {
  chips: AffectsChip[];
  testId?: string;
  active?: boolean;
  onChipClick?: () => void;
};

export function AffectsChips({
  chips,
  testId = "affects-chips",
  active = false,
  onChipClick,
}: AffectsChipsProps) {
  if (chips.length === 0) return null;
  return (
    <ul
      className={`affects-chips${active ? " affects-chips--active" : ""}`}
      data-testid={testId}
      data-active={active ? "true" : undefined}
      aria-label="Cost affects"
    >
      {chips.map((c) => (
        <li key={c.meterId} data-meter={c.meterId}>
          {onChipClick ? (
            <button
              type="button"
              className="affects-chip-btn"
              data-testid={`${testId}-btn-${c.meterId}`}
              onClick={onChipClick}
            >
              {formatAffectsChip(c)}
            </button>
          ) : (
            formatAffectsChip(c)
          )}
        </li>
      ))}
    </ul>
  );
}
