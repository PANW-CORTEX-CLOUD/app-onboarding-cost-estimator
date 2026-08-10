/**
 * Demo preset picker — visible chips only (one UI pattern).
 * Per-preset testids preserved for MVP/e2e.
 */
import { DEMO_PRESETS, type DemoPreset } from "../../features/demo-presets/demoPresets.ts";

export type DemoPresetPickerProps = {
  onApply: (preset: DemoPreset) => void;
  disabled?: boolean;
};

export function DemoPresetPicker({
  onApply,
  disabled = false,
}: DemoPresetPickerProps) {
  return (
    <div>
      <p className="section-lede">
        One click fills provider, region, capabilities, and volume.
      </p>
      <div
        data-testid="demo-presets"
        className="demo-preset-chips"
        role="group"
        aria-label="Demo presets"
      >
        {DEMO_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            data-testid={`demo-preset-${p.id}`}
            onClick={() => onApply(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
