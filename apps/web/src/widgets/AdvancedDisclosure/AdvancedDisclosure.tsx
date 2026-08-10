/**
 * Progressive disclosure for billing calibration (local CSV).
 */
import { useState, type ReactNode } from "react";

export type AdvancedDisclosureProps = {
  children: ReactNode;
};

export function AdvancedDisclosure({ children }: AdvancedDisclosureProps) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="advanced-disclosure">
      <button
        type="button"
        aria-expanded={open}
        data-testid="advanced-disclosure-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide" : "Show"} billing calibration
      </button>
      {open ? (
        <div data-testid="advanced-disclosure-panel">{children}</div>
      ) : null}
    </div>
  );
}
