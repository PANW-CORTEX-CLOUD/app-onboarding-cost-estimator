/**
 * Persistent disclaimer with session-only collapse (package 22 EDGE).
 * Cannot permanently hide in v1 — refresh restores visible state.
 */
import { useState } from "react";
import { ESTIMATE_DISCLAIMER } from "../../shared/model/disclaimer.ts";

export type DisclaimerProps = {
  modelVersion?: string;
};

export function Disclaimer({ modelVersion }: DisclaimerProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside aria-label="Disclaimer" data-testid="disclaimer">
      <div className="disclaimer-toolbar">
        <button
          type="button"
          data-testid="disclaimer-collapse"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "Show disclaimer" : "Collapse disclaimer (session only)"}
        </button>
        <span className="muted" data-testid="disclaimer-lang">
          English baseline
        </span>
      </div>
      {collapsed ? (
        <p data-testid="disclaimer-collapsed-note">
          Disclaimer collapsed for this session only — still included in exports.
        </p>
      ) : (
        <>
          <p data-testid="disclaimer-text">{ESTIMATE_DISCLAIMER}</p>
          {modelVersion ? <p>Model version: {modelVersion}</p> : null}
        </>
      )}
    </aside>
  );
}

export { ESTIMATE_DISCLAIMER };
