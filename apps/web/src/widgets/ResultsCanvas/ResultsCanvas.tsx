/**
 * Tabbed results canvas — cost (flip), projections, compare.
 */
import type { ReactNode } from "react";

export type ResultsTab = "cost" | "projections" | "compare";

export type ResultsCanvasProps = {
  activeTab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  children: ReactNode;
};

const TABS: { id: ResultsTab; label: string; hint: string }[] = [
  {
    id: "cost",
    label: "Cost",
    hint: "Drivers (high level) or meters (flip for detail)",
  },
  {
    id: "projections",
    label: "Projections",
    hint: "Forward months and growth",
  },
  {
    id: "compare",
    label: "Compare",
    hint: "Providers or audit vs comprehensive",
  },
];

export function ResultsCanvas({
  activeTab,
  onTabChange,
  children,
}: ResultsCanvasProps) {
  const active = TABS.find((t) => t.id === activeTab);
  return (
    <div data-testid="results-canvas" className="results-canvas">
      <div role="tablist" aria-label="Results views" className="results-tabs">
        {TABS.map((t) => {
          const tabId = `results-tab-${t.id}`;
          const panelId = `results-panel-${t.id}`;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={activeTab === t.id}
              aria-controls={panelId}
              title={t.hint}
              data-testid={tabId}
              className={activeTab === t.id ? "tab-active" : undefined}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <p className="results-tab-hint" aria-live="polite">
          {active.hint}
        </p>
      ) : null}
      <div
        role="tabpanel"
        id={`results-panel-${activeTab}`}
        aria-labelledby={`results-tab-${activeTab}`}
        className="results-panel"
        data-testid={`results-panel-${activeTab}`}
      >
        {children}
      </div>
    </div>
  );
}
