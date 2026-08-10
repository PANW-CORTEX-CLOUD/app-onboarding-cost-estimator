/**
 * Package 32–33 — honesty banner + Azure audit meter allowlist (UI).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { App } from "../app/App.tsx";
import type { CostApiClient } from "../shared/api/client.ts";
import { clearEstimateCache } from "../shared/lib/estimate-cache.ts";
import { ESTIMATOR_BOOTSTRAP_SESSION_KEY } from "../shared/lib/estimator-bootstrap.ts";
import {
  EstimateHonestyBanner,
  isHonestyWarning,
} from "../widgets/EstimateHonestyBanner/EstimateHonestyBanner.tsx";
import { AZURE_AUDIT_ONLY_METER_ALLOWLIST } from "../widgets/EstimateHonestyBanner/tfHonestyConstants.ts";
import { getDemoPreset } from "../features/demo-presets/demoPresets.ts";

function mockAuditEstimate(warnings: string[] = []) {
  return {
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
    ],
    totals: { expected: 26.9208 },
    confidence: "High" as const,
    modelVersion: "0.1.3",
    ratesAsOf: "2026-07-01T00:00:00.000Z",
    inputHash: "tf-audit",
    ratesSource: "fallback" as const,
    warnings,
    resolvedVolume: {
      ingressGBPerDay: 10,
      peakMBps: 1,
      peakEventsPerSec: 1000,
      overrideStreamMetrics: true,
    },
  };
}

function createMockClient(warnings: string[] = []): CostApiClient {
  const GET = vi.fn(async () => ({
    data: {
      provider: "azure",
      capabilities: [],
    },
    error: undefined,
    response: new Response(null, { status: 200 }),
  }));

  const POST = vi.fn(async (path: string, init?: { body?: { capabilities?: Record<string, boolean> } }) => {
    if (path === "/projections") {
      return {
        data: {
          series: [],
          table: [],
          total: 0,
          monthlyBaseline: 0,
          annualGrowthPercent: 0,
          modelVersion: "0.1.3",
          disclaimer: "Indicative",
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    const caps = init?.body?.capabilities ?? {};
    const modeledOn =
      caps.adsCloud ||
      caps.dspm ||
      caps.registry ||
      caps.serverless ||
      caps.egress;
    const w = [...warnings];
    if (modeledOn) {
      w.push(
        "Azure connector TF bills audit stream+store only; modeled · no connector TF: ads_cloud, dspm",
      );
    }
    return {
      data: mockAuditEstimate(w),
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return { GET, POST } as unknown as CostApiClient;
}

describe("package 32 — EstimateHonestyBanner", () => {
  it("renders honesty warnings and ignores unrelated rate noise", () => {
    const { rerender } = render(
      <EstimateHonestyBanner
        warnings={[
          "Rates aging",
          "Azure connector TF bills audit stream+store only; modeled · no connector TF: dspm",
        ]}
      />,
    );
    expect(screen.getByTestId("estimate-honesty-banner")).toBeInTheDocument();
    expect(screen.getByText(/modeled · no connector TF: dspm/i)).toBeInTheDocument();
    rerender(<EstimateHonestyBanner warnings={["Rates aging only"]} />);
    expect(screen.queryByTestId("estimate-honesty-banner")).toBeNull();
  });

  it("isHonestyWarning matches prefixes", () => {
    expect(
      isHonestyWarning(
        "Azure connector TF bills audit stream+store only; modeled · no connector TF: egress",
      ),
    ).toBe(true);
    expect(isHonestyWarning("AWS: no TF inventory — modeled defaults")).toBe(
      true,
    );
    expect(isHonestyWarning("azure retail empty Items; using fallback")).toBe(
      false,
    );
  });
});

describe("package 32–33 — UI honesty + audit allowlist", () => {
  beforeEach(() => {
    clearEstimateCache();
    sessionStorage.setItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("azure audit-only run shows no honesty banner; comprehensive does", async () => {
    const client = createMockClient();
    render(<App client={client} />);

    fireEvent.click(screen.getByTestId("demo-preset-azure-audit"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() =>
      expect(screen.getByTestId("summary-monthly-expected")).not.toHaveTextContent(
        /—\s*$/,
      ),
    );
    expect(screen.queryByTestId("estimate-honesty-banner")).toBeNull();

    fireEvent.click(screen.getByTestId("demo-preset-azure-comprehensive"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() =>
      expect(screen.getByTestId("estimate-honesty-banner")).toBeInTheDocument(),
    );
  });

  it("azure-audit demo preset meters ⊆ TF allowlist", () => {
    const preset = getDemoPreset("azure-audit");
    expect(preset.capabilities.auditLogs).toBe(true);
    expect(preset.capabilities.dspm).toBe(false);
    expect(preset.volume.peakMBps).toBe(1);
    expect(preset.volume.peakEventsPerSec).toBe(1000);
    for (const id of [
      "eh-standard-tu",
      "eh-standard-ingress-events",
      "blob-hot-lrs-capacity",
    ]) {
      expect(
        (AZURE_AUDIT_ONLY_METER_ALLOWLIST as readonly string[]).includes(id),
      ).toBe(true);
    }
  });
});
