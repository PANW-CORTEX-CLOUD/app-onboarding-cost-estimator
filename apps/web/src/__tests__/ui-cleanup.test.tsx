/**
 * Packages 01–08 — UI cleanup + Results completeness.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResultsSummary } from "../widgets/ResultsSummary/ResultsSummary.tsx";
import { ResultsCanvas } from "../widgets/ResultsCanvas/ResultsCanvas.tsx";
import { ResultsProvenance } from "../widgets/ResultsProvenance/ResultsProvenance.tsx";
import { ResultsAssumptionsSnapshot } from "../widgets/ResultsAssumptionsSnapshot/ResultsAssumptionsSnapshot.tsx";
import {
  EstimateWarningsList,
  filterNonHonestyWarnings,
} from "../widgets/EstimateWarningsList/EstimateWarningsList.tsx";
import { EstimateHonestyBanner } from "../widgets/EstimateHonestyBanner/EstimateHonestyBanner.tsx";
import { CompareScenarios } from "../widgets/CompareScenarios/CompareScenarios.tsx";
import { AdvancedDisclosure } from "../widgets/AdvancedDisclosure/AdvancedDisclosure.tsx";
import { CapabilityToggles } from "../widgets/CapabilityToggles/CapabilityToggles.tsx";
import { AZURE_MODELED_NO_TF_WARNING_PREFIX } from "../widgets/EstimateHonestyBanner/tfHonestyConstants.ts";

afterEach(() => {
  cleanup();
});

describe("package 01/08 — advanced disclosure calibration only", () => {
  it("toggle shows calibration children; no advanced-paste", () => {
    render(
      <AdvancedDisclosure>
        <div data-testid="calibration-panel">cal</div>
      </AdvancedDisclosure>,
    );
    expect(screen.queryByTestId("advanced-paste")).toBeNull();
    expect(screen.queryByTestId("advanced-disclosure-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("advanced-disclosure-toggle"));
    expect(screen.getByTestId("calibration-panel")).toBeInTheDocument();
    expect(screen.getByTestId("advanced-disclosure-toggle")).toHaveTextContent(
      /calibration/i,
    );
  });
});

describe("package 02/08 — shorter capability lede", () => {
  it("does not repeat long TF essay in toggles lede", () => {
    render(
      <CapabilityToggles
        value={{
          discovery: false,
          auditLogs: true,
          adsCloud: false,
          adsOutpost: false,
          dspm: false,
          registry: false,
          serverless: false,
          egress: false,
        }}
        onChange={() => undefined}
      />,
    );
    const lede = screen.getByTestId("capability-toggles").querySelector(
      ".section-lede",
    );
    expect(lede?.textContent).not.toMatch(/TF-grounded/i);
    expect(lede?.textContent).toMatch(/Discovery alone stays \$0/);
  });
});

describe("package 04/08 — ResultsSummary densify", () => {
  it("shows confidence once; no SaaS unit-hint", () => {
    render(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={10}
        confidence="High"
        freshnessLevel="fresh"
        freshnessLabel="fresh"
        ratesSource="fallback"
        ratesAsOf="2026-07-01"
      />,
    );
    expect(screen.getByTestId("summary-confidence")).toBeInTheDocument();
    expect(screen.queryByText(/not Cortex SaaS/i)).toBeNull();
  });
});

describe("package 06/08 — ResultsCanvas a11y", () => {
  it("tabs expose aria-controls and panel labelledby", () => {
    render(
      <ResultsCanvas activeTab="cost" onTabChange={() => undefined}>
        <div>body</div>
      </ResultsCanvas>,
    );
    const tab = screen.getByTestId("results-tab-cost");
    expect(tab).toHaveAttribute("aria-controls", "results-panel-cost");
    expect(tab).toHaveAttribute("id", "results-tab-cost");
    const panel = screen.getByTestId("results-panel-cost");
    expect(panel).toHaveAttribute("aria-labelledby", "results-tab-cost");
  });
});

describe("package 07/08 — warnings + provenance", () => {
  it("filters honesty vs other warnings; shows hash and resolved chip", () => {
    const honesty = `${AZURE_MODELED_NO_TF_WARNING_PREFIX} DSPM`;
    const other = "Zero VMs — ADS outpost $0";
    expect(
      filterNonHonestyWarnings([honesty, other], "Rates aging."),
    ).toEqual([other]);

    render(
      <>
        <EstimateHonestyBanner warnings={[honesty, other]} />
        <EstimateWarningsList
          warnings={[honesty, other]}
          freshnessMessage="Rates aging."
        />
        <ResultsProvenance
          inputHash="abcdef0123456789deadbeef"
          modelVersion="0.1.3"
          resolvedVolume={{
            ingressGBPerDay: 10,
            peakMBps: 1,
            peakEventsPerSec: 1000,
            overrideStreamMetrics: false,
          }}
        />
      </>,
    );
    expect(screen.getByTestId("estimate-honesty-banner")).toBeInTheDocument();
    expect(screen.getByTestId("estimate-warnings").textContent).toMatch(
      /Zero VMs/,
    );
    expect(screen.getByTestId("estimate-warnings").textContent).not.toMatch(
      /DSPM/,
    );
    expect(screen.getByTestId("results-input-hash")).toBeInTheDocument();
    expect(screen.getByTestId("resolved-volume-chip")).toHaveTextContent(
      /ingress 10/,
    );
  });

  it("EDGE: empty warnings / no resolvedVolume", () => {
    const { rerender } = render(
      <EstimateWarningsList warnings={[]} />,
    );
    expect(screen.queryByTestId("estimate-warnings")).toBeNull();
    rerender(
      <ResultsProvenance inputHash="abc" modelVersion="0.1.3" />,
    );
    expect(screen.queryByTestId("resolved-volume-chip")).toBeNull();
  });
});

describe("package 08/08 — compare bands + assumptions", () => {
  it("compare shows confidence and range", () => {
    render(
      <CompareScenarios
        mode="tiers"
        onModeChange={() => undefined}
        onRunCompare={() => undefined}
        columns={[
          {
            id: "foundational",
            label: "Foundational",
            provider: "azure",
            expected: 10,
            low: 8,
            high: 12,
            confidence: "High",
          },
          {
            id: "comprehensive",
            label: "Comprehensive",
            provider: "azure",
            expected: 50,
            low: 40,
            high: 60,
            confidence: "Low",
            literacyNote: "Modeled: ADS",
          },
        ]}
      />,
    );
    expect(screen.getByTestId("compare-confidence-foundational")).toHaveTextContent(
      "High",
    );
    expect(screen.getByTestId("compare-range-comprehensive").textContent).toMatch(
      /\$40/,
    );
  });

  it("EDGE: null bands and error show — ; assumptions snapshot renders", () => {
    render(
      <>
        <CompareScenarios
          mode="providers"
          onModeChange={() => undefined}
          onRunCompare={() => undefined}
          columns={[
            {
              id: "azure",
              label: "a",
              provider: "azure",
              expected: null,
              error: "failed",
            },
          ]}
        />
        <ResultsAssumptionsSnapshot
          monthHours={730}
          assumedEventBytes={1024}
          avgStoredGB={0}
          logIntensity="medium"
        />
      </>,
    );
    expect(screen.getByTestId("compare-range-azure")).toHaveTextContent("—");
    expect(screen.getByTestId("compare-confidence-azure")).toHaveTextContent("—");
    expect(screen.getByTestId("results-assumptions-snapshot")).toHaveTextContent(
      /730 h\/month/,
    );
  });
});

describe("package 05/08 — auto-update chip focus helper", () => {
  it("chip click invokes handler", () => {
    const onClick = vi.fn();
    render(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={1}
        freshnessLevel={null}
        freshnessLabel={null}
        onAutoUpdateChipClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId("auto-update-status-chip"));
    expect(onClick).toHaveBeenCalled();
  });
});
