/**
 * ProviderSelector widget — Azure default; AWS/GCP selectable.
 * Keyboard: radiogroup + arrow keys; no formulas.
 */
import type { KeyboardEvent } from "react";
import {
  CLOUD_PROVIDERS,
  PROVIDER_LABELS,
  type CloudProvider,
} from "../../entities/provider/model.ts";

export type ProviderSelectorProps = {
  value: CloudProvider;
  onChange: (provider: CloudProvider) => void;
  disabled?: boolean;
};

export function ProviderSelector({
  value,
  onChange,
  disabled = false,
}: ProviderSelectorProps) {
  const idx = CLOUD_PROVIDERS.indexOf(value);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (idx + 1) % CLOUD_PROVIDERS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (idx - 1 + CLOUD_PROVIDERS.length) % CLOUD_PROVIDERS.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      next = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      next = CLOUD_PROVIDERS.length - 1;
    } else {
      return;
    }
    onChange(CLOUD_PROVIDERS[next]!);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Cloud provider"
      onKeyDown={onKeyDown}
    >
      {CLOUD_PROVIDERS.map((p) => {
        const selected = p === value;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            data-provider={p}
            onClick={() => onChange(p)}
          >
            {PROVIDER_LABELS[p]}
          </button>
        );
      })}
    </div>
  );
}
