/**
 * Package 34–37 + literacy polish 01–07 — drivers, chips, help, sync, sensitivity, provenance.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CostDrivers } from "../widgets/CostDrivers/CostDrivers.tsx";
import { VolumeSignalsForm } from "../widgets/VolumeSignals/VolumeSignalsForm.tsx";
import { BillingHelpPanel } from "../widgets/BillingHelpPanel/BillingHelpPanel.tsx";
import { ResultsSummary } from "../widgets/ResultsSummary/ResultsSummary.tsx";
import {
  CompareScenarios,
  tierLiteracyNote,
} from "../widgets/CompareScenarios/CompareScenarios.tsx";
import {
  buildAffectsChips,
  buildAffectsByField,
  formatAffectsChip,
} from "../shared/lib/affects-chips.ts";
import {
  explainDriver,
  jumpToInputTestId,
  metersForCapability,
} from "../shared/lib/cost-driver-explain.ts";
import { getBillingHelp } from "../shared/model/billing-help.ts";
import {
  tfGroundingForCapability,
  tfGroundingLabel,
} from "../shared/model/tf-grounding.ts";
import {
  ESTIMATOR_BOOTSTRAP_SESSION_KEY,
  shouldBootstrapAzureAudit,
} from "../shared/lib/estimator-bootstrap.ts";

afterEach(() => {
  cleanup();
});

const azureAuditEstimate = {
  provider: "azure" as const,
  lineItems: [
    {
      provider: "azure" as const,
      capability: "audit_logs",
      meterId: "eh-standard-tu",
      amount: 21.9,
      confidence: "High" as const,
    },
    {
      provider: "azure" as const,
      capability: "audit_logs",
      meterId: "eh-standard-ingress-events",
      amount: 5,
      confidence: "High" as const,
    },
    {
      provider: "azure" as const,
      capability: "audit_logs",
      meterId: "blob-hot-lrs-capacity",
      amount: 0.0208,
      confidence: "High" as const,
    },
    {
      provider: "azure" as const,
      capability: "dspm",
      meterId: "blob-data-read-ops",
      amount: 10,
      confidence: "Low" as const,
    },
  ],
  totals: { expected: 36.9208 },
  confidence: "Low" as const,
  modelVersion: "0.1.3",
  ratesAsOf: "2026-07-01",
  inputHash: "x",
};

describe("package 34 — CostDrivers why panel", () => {
  it("expands audit_logs and lists three meters + formula", () => {
    render(<CostDrivers estimate={azureAuditEstimate} />);
    const why = screen.getByTestId("driver-why-audit_logs");
    expect(why).toBeInTheDocument();
    fireEvent.click(why.querySelector("summary")!);
    const meters = screen.getByTestId("driver-meters-audit_logs");
    expect(meters.textContent).toContain("eh-standard-tu");
    expect(meters.textContent).toContain("eh-standard-ingress-events");
    expect(meters.textContent).toContain("blob-hot-lrs-capacity");
    expect(screen.getByTestId("driver-formula-audit_logs").textContent).toMatch(
      /1 TU/i,
    );
  });

  it("jump button focuses matching input testid", () => {
    const input = document.createElement("input");
    input.setAttribute("data-testid", "input-peak-mbps");
    document.body.appendChild(input);
    const focus = vi.spyOn(input, "focus");
    const { unmount } = render(<CostDrivers estimate={azureAuditEstimate} />);
    fireEvent.click(
      screen.getByTestId("driver-why-audit_logs").querySelector("summary")!,
    );
    fireEvent.click(screen.getByTestId("jump-audit_logs-input-peak-mbps"));
    expect(focus).toHaveBeenCalled();
    expect(jumpToInputTestId("missing-input")).toBe(false);
    unmount();
    input.remove();
  });

  it("EDGE: empty / discovery unchanged; unknown meter listed raw", () => {
    const { rerender } = render(<CostDrivers estimate={null} />);
    expect(screen.getByTestId("cost-drivers-empty")).toBeInTheDocument();
    rerender(<CostDrivers discoveryOnlyEmpty estimate={null} />);
    expect(screen.getByTestId("discovery-only-empty")).toBeInTheDocument();

    const meters = metersForCapability(
      [
        {
          capability: "audit_logs",
          meterId: "totally-unknown-meter",
          amount: 1,
          confidence: "Med",
        },
      ],
      "audit_logs",
    );
    expect(meters[0].meterId).toBe("totally-unknown-meter");
    expect(explainDriver("azure", "never_heard_of").formula).toMatch(/Breakdown/i);
  });

  it("top driver shows −20% apply control when handler provided", () => {
    const onApply = vi.fn();
    render(
      <CostDrivers estimate={azureAuditEstimate} onApplyPeakMinus20={onApply} />,
    );
    fireEvent.click(
      screen.getByTestId("driver-why-audit_logs").querySelector("summary")!,
    );
    fireEvent.click(screen.getByTestId("apply-peak-minus-20"));
    expect(onApply).toHaveBeenCalled();
  });
});

describe("package 35 — Affects chips", () => {
  it("Azure peak → Event Hubs capacity with live $", () => {
    const chips = buildAffectsChips(
      "azure",
      azureAuditEstimate.lineItems,
      "peakMBps",
    );
    expect(chips).toHaveLength(1);
    expect(chips[0].meterId).toBe("eh-standard-tu");
    expect(chips[0].amount).toBe(21.9);
    expect(formatAffectsChip(chips[0])).toMatch(/Event Hubs capacity/);
    expect(formatAffectsChip(chips[0])).toMatch(/\$21\.90/);
  });

  it("hides chips when no estimate / empty lines", () => {
    expect(buildAffectsByField("azure", null)).toEqual({});
    expect(buildAffectsChips("azure", [], "peakMBps")).toEqual([]);
  });

  it("EDGE: never invent missing meters; skip zero amounts", () => {
    expect(
      buildAffectsChips(
        "azure",
        [{ meterId: "eh-standard-tu", amount: 0 }],
        "peakMBps",
      ),
    ).toEqual([]);
    expect(
      buildAffectsChips(
        "azure",
        [{ meterId: "unrelated", amount: 9 }],
        "peakMBps",
      ),
    ).toEqual([]);
  });

  it("RTL: chips render under peak when provided; absent when empty", () => {
    const { rerender } = render(
      <VolumeSignalsForm
        ingressGBPerDay={10}
        peakMBps={1}
        peakEventsPerSec={1000}
        onChange={() => undefined}
        affectsPeakMBps={[
          {
            meterId: "eh-standard-tu",
            friendlyName: "Event Hubs capacity (TU)",
            amount: 21.9,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("affects-peak-mbps")).toHaveTextContent(
      /Event Hubs capacity/,
    );
    rerender(
      <VolumeSignalsForm
        ingressGBPerDay={10}
        peakMBps={1}
        peakEventsPerSec={1000}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("affects-peak-mbps")).toBeNull();
  });
});

describe("package 36 — BillingHelpPanel", () => {
  it("Azure audit lists EH+blob meters", () => {
    render(<BillingHelpPanel provider="azure" family="audit" />);
    expect(screen.getByTestId("billing-help-audit")).toBeInTheDocument();
    const meters = screen.getByTestId("billing-help-audit-meters");
    expect(meters.textContent).toMatch(/eh-standard-tu/);
    expect(meters.textContent).toMatch(/blob-hot-lrs-capacity/);
    expect(getBillingHelp("azure", "audit").notes.join(" ")).toMatch(/Capture/i);
  });

  it("AWS/GCP audit copy says modeled / no TF claim", () => {
    expect(getBillingHelp("aws", "audit").summary).toMatch(/No connector TF/i);
    expect(getBillingHelp("gcp", "audit").summary).toMatch(/No connector TF/i);
    expect(getBillingHelp("aws", "audit").title).toMatch(/modeled/i);
  });

  it("EDGE: audit help unmounted when caller hides (audit off)", () => {
    const { rerender } = render(
      <BillingHelpPanel provider="azure" family="audit" />,
    );
    expect(screen.getByTestId("billing-help-audit")).toBeInTheDocument();
    rerender(<div data-testid="no-audit-help" />);
    expect(screen.queryByTestId("billing-help-audit")).toBeNull();
  });
});

describe("package 01/07 — driver↔chip sync + TF badges", () => {
  it("Azure audit TF-grounded; DSPM modeled; active driver highlights chips", () => {
    expect(tfGroundingLabel(tfGroundingForCapability("azure", "audit_logs"))).toBe(
      "TF-grounded",
    );
    expect(tfGroundingLabel(tfGroundingForCapability("azure", "dspm"))).toBe(
      "Modeled · no TF",
    );
    const onChip = vi.fn();
    render(
      <>
        <CostDrivers
          estimate={azureAuditEstimate}
          activeCapability="audit_logs"
        />
        <VolumeSignalsForm
          ingressGBPerDay={10}
          peakMBps={1}
          peakEventsPerSec={1000}
          onChange={() => undefined}
          auditChipsActive
          onAuditChipClick={onChip}
          affectsPeakMBps={[
            {
              meterId: "eh-standard-tu",
              friendlyName: "Event Hubs capacity (TU)",
              amount: 21.9,
            },
          ]}
        />
      </>,
    );
    expect(screen.getByTestId("driver-audit_logs")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByTestId("driver-badge-audit_logs")).toHaveTextContent(
      "TF-grounded",
    );
    expect(screen.getByTestId("driver-badge-dspm")).toHaveTextContent(
      "Modeled · no TF",
    );
    expect(screen.getByTestId("affects-peak-mbps")).toHaveAttribute(
      "data-active",
      "true",
    );
    fireEvent.click(screen.getByTestId("affects-peak-mbps-btn-eh-standard-tu"));
    expect(onChip).toHaveBeenCalled();
  });

  it("EDGE: no estimate → no chip highlight; AWS audit is modeled", () => {
    expect(tfGroundingForCapability("aws", "audit_logs")).toBe("modeled");
    expect(tfGroundingForCapability("gcp", "audit_logs")).toBe("modeled");
    render(
      <VolumeSignalsForm
        ingressGBPerDay={10}
        peakMBps={1}
        peakEventsPerSec={1000}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByTestId("affects-peak-mbps")).toBeNull();
  });
});

describe("package 02/07 — sensitivity strip", () => {
  it("shows delta after apply when previousExpected differs", () => {
    const onMinus = vi.fn();
    const onPlus = vi.fn();
    render(
      <CostDrivers
        estimate={azureAuditEstimate}
        onApplyPeakMinus20={onMinus}
        onApplyPeakPlus1={onPlus}
        previousExpected={40}
      />,
    );
    fireEvent.click(
      screen.getByTestId("driver-why-audit_logs").querySelector("summary")!,
    );
    expect(screen.getByTestId("sensitivity-delta").textContent).toMatch(
      /Was \$40\.00/,
    );
    fireEvent.click(screen.getByTestId("apply-peak-plus-1"));
    expect(onPlus).toHaveBeenCalled();
  });

  it("EDGE: no invent pre-run $; Updating while re-estimate; hidden without estimate", () => {
    const { rerender } = render(
      <CostDrivers
        estimate={azureAuditEstimate}
        previousExpected={36.9208}
        sensitivityUpdating
      />,
    );
    fireEvent.click(
      screen.getByTestId("driver-why-audit_logs").querySelector("summary")!,
    );
    expect(screen.getByTestId("sensitivity-updating")).toBeInTheDocument();
    expect(screen.queryByTestId("sensitivity-delta")).toBeNull();
    rerender(<CostDrivers estimate={null} />);
    expect(screen.queryByTestId("apply-peak-minus-20")).toBeNull();
  });
});

describe("package 03/07 — bootstrap gate", () => {
  it("allows cold Azure load when sentinel absent", () => {
    expect(shouldBootstrapAzureAudit("", () => null)).toBe(true);
    expect(shouldBootstrapAzureAudit("?provider=azure", () => null)).toBe(true);
  });

  it("EDGE: skips share / aws / sentinel", () => {
    expect(shouldBootstrapAzureAudit("?s=abc", () => null)).toBe(false);
    expect(shouldBootstrapAzureAudit("?provider=aws", () => null)).toBe(false);
    expect(
      shouldBootstrapAzureAudit("", (k) =>
        k === ESTIMATOR_BOOTSTRAP_SESSION_KEY ? "1" : null,
      ),
    ).toBe(false);
  });
});

describe("package 04–05/07 — provenance + auto-update chip", () => {
  it("shows region · ratesSource · ratesAsOf under total", () => {
    render(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={36.9}
        freshnessLevel="fresh"
        freshnessLabel="fresh"
        ratesSource="fallback"
        ratesAsOf="2026-07-01"
      />,
    );
    expect(screen.getByTestId("summary-provenance").textContent).toMatch(
      /eastus · fallback · ratesAsOf 2026-07-01/,
    );
  });

  it("EDGE: missing ratesAsOf → n/a", () => {
    render(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={1}
        freshnessLevel={null}
        freshnessLabel={null}
        ratesSource="live"
        ratesAsOf=""
      />,
    );
    expect(screen.getByTestId("summary-provenance").textContent).toMatch(
      /ratesAsOf n\/a/,
    );
  });

  it("auto-update chip reflects on / Updating / offline", () => {
    const { rerender } = render(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={1}
        freshnessLevel={null}
        freshnessLabel={null}
        autoRunEnabled
      />,
    );
    expect(screen.getByTestId("auto-update-status-chip")).toHaveTextContent(
      "Auto-update on",
    );
    rerender(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={1}
        freshnessLevel={null}
        freshnessLabel={null}
        autoRunEnabled
        loading
      />,
    );
    expect(screen.getByTestId("auto-update-status-chip")).toHaveTextContent(
      "Updating…",
    );
    rerender(
      <ResultsSummary
        provider="azure"
        region="eastus"
        monthlyExpected={1}
        freshnessLevel={null}
        freshnessLabel={null}
        autoRunEnabled={false}
        offlineEngine
      />,
    );
    expect(screen.getByTestId("auto-update-status-chip")).toHaveTextContent(
      /Offline/,
    );
  });
});

describe("package 06/07 — compare literacy", () => {
  it("Azure tiers: TF-faithful foundational + modeled comprehensive", () => {
    expect(tierLiteracyNote("azure", "foundational")).toMatch(/TF-faithful/);
    expect(tierLiteracyNote("azure", "comprehensive")).toMatch(/Modeled:/);
    render(
      <CompareScenarios
        mode="tiers"
        onModeChange={() => undefined}
        onRunCompare={() => undefined}
        columns={[
          {
            id: "foundational",
            label: "Foundational (audit)",
            provider: "azure",
            expected: 10,
            literacyNote: tierLiteracyNote("azure", "foundational"),
          },
          {
            id: "comprehensive",
            label: "Comprehensive",
            provider: "azure",
            expected: 50,
            literacyNote: tierLiteracyNote("azure", "comprehensive"),
          },
        ]}
      />,
    );
    expect(screen.getByTestId("compare-literacy-foundational")).toHaveTextContent(
      /TF-faithful/,
    );
    expect(
      screen.getByTestId("compare-literacy-comprehensive"),
    ).toHaveTextContent(/ADS/);
  });

  it("EDGE: AWS/GCP both columns note no TF", () => {
    expect(tierLiteracyNote("aws", "foundational")).toMatch(/No connector TF/);
    expect(tierLiteracyNote("gcp", "comprehensive")).toMatch(/No connector TF/);
  });
});

describe("package 07/07 — quieter billing help", () => {
  it("billing-help stays closed by default", () => {
    render(<BillingHelpPanel provider="azure" family="audit" />);
    const el = screen.getByTestId("billing-help-audit");
    expect(el).not.toHaveAttribute("open");
    expect((el as HTMLDetailsElement).open).toBe(false);
  });
});
