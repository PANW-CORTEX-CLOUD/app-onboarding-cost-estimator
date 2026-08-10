/**
 * Package 18 — UI information architecture tests (packages 26–29 layout).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { App } from "../app/App.tsx";
import type { CostApiClient } from "../shared/api/client.ts";
import { clearEstimateCache, saveEstimateCache } from "../shared/lib/estimate-cache.ts";
import { ESTIMATOR_BOOTSTRAP_SESSION_KEY } from "../shared/lib/estimator-bootstrap.ts";
import {
  CAPABILITY_DEBOUNCE_MS,
  debounce,
} from "../shared/lib/debounce.ts";
import { isDiscoveryOnly } from "../widgets/CapabilityToggles/CapabilityToggles.tsx";
import { SectionErrorBoundary } from "../shared/ui/SectionErrorBoundary.tsx";

function mockEstimate(provider: "azure" | "aws" | "gcp", amount = 12.34) {
  return {
    provider,
    lineItems: [
      {
        provider,
        capability: "audit_logs",
        meterId: "meter-1",
        amount,
        confidence: "Med" as const,
      },
    ],
    totals: { expected: amount },
    confidence: "Med" as const,
    modelVersion: "0.1.2",
    ratesAsOf: "2026-07-01T00:00:00.000Z",
    inputHash: "abc",
    ratesSource: "fallback" as const,
    warnings: [],
  };
}

function createMockClient(): CostApiClient {
  const GET = vi.fn(async (_path: string, init?: { params?: { query?: { provider?: string } } }) => {
    const provider = init?.params?.query?.provider ?? "azure";
    return {
      data: {
        provider,
        capabilities: [
          {
            capability: "auditLogs",
            meterId: `${provider}-audit`,
            confidence: "Med" as const,
            sourceUrl: "https://example.com",
          },
        ],
      },
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  const POST = vi.fn(async (path: string, init?: { body?: { provider?: string; capabilities?: Record<string, boolean> } }) => {
    if (path === "/projections") {
      const expected = 12.34;
      const series = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        expected,
        cumulative: expected * (i + 1),
        volumeIndex: 1,
        stacks: [
          {
            provider: "azure",
            capability: "audit_logs",
            meterId: "meter-1",
            amount: expected,
            confidence: "Med",
          },
        ],
      }));
      return {
        data: {
          series,
          table: series,
          total: expected * 12,
          monthlyBaseline: expected,
          annualGrowthPercent: 0,
          modelVersion: "0.1.2",
          disclaimer:
            "Indicative projection only. Does not imply reserved instance, savings plans, or CUD pricing.",
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    const provider = (init?.body?.provider ?? "azure") as "azure" | "aws" | "gcp";
    const caps = init?.body?.capabilities ?? {};
    const onlyDiscovery =
      caps.discovery === true &&
      !caps.auditLogs &&
      !caps.adsCloud &&
      !caps.adsOutpost &&
      !caps.dspm &&
      !caps.registry &&
      !caps.serverless &&
      !caps.egress;
    if (onlyDiscovery) {
      return {
        data: {
          ...mockEstimate(provider, 0),
          lineItems: [],
          totals: { expected: 0 },
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    return {
      data: mockEstimate(provider),
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return { GET, POST } as unknown as CostApiClient;
}

describe("package 18 — UI IA", () => {
  beforeEach(() => {
    clearEstimateCache();
    sessionStorage.setItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
    window.history.replaceState({}, "", "/");
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders workspace sections with main landmark", async () => {
    render(<App client={createMockClient()} />);
    expect(document.querySelector("main")).toBeTruthy();
    expect(screen.getByTestId("journey-tab-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("journey-tab-cost")).toBeInTheDocument();
    for (const id of [
      "provider-region",
      "scope-accounts",
      "capability-toggles",
      "volume-signals",
      "model-assumptions",
      "rates-freshness",
      "results-summary",
      "export-disclaimer",
    ]) {
      expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("capabilities-list")).toBeNull();
    expect(screen.getByTestId("assumptions-panel")).toBeInTheDocument();
    expect(screen.getByTestId("results-canvas")).toBeInTheDocument();
  });

  it("journey IA: Inputs before Cost; non-sticky; one summary in Cost", () => {
    render(<App client={createMockClient()} />);
    expect(screen.getByTestId("journey-intro")).toBeInTheDocument();
    expect(screen.getByTestId("journey-tab-inputs")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const provider = screen.getByTestId("section-provider-region");
    const costPanel = screen.getByTestId("journey-panel-cost");
    expect(
      provider.compareDocumentPosition(costPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("journey-tab-cost"));
    expect(
      screen.getByRole("heading", { name: "Cost output" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("results-grounding")).toBeInTheDocument();

    const canvas = screen.getByTestId("estimator-canvas");
    expect(getComputedStyle(canvas).position).not.toBe("sticky");

    const summaries = screen.getAllByTestId("results-summary");
    expect(summaries).toHaveLength(1);
    expect(costPanel.contains(summaries[0]!)).toBe(true);
  });

  it("first viewport shows journey intro and Inputs provider", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    expect(screen.getByTestId("journey-intro")).toBeInTheDocument();
    expect(screen.getByTestId("section-provider-region")).toBeInTheDocument();
    expect(screen.getByTestId("journey-tab-inputs")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("summary-monthly-expected")).toHaveTextContent(
        "$12.34",
      );
      expect(screen.getByTestId("freshness-chip")).toHaveAttribute(
        "data-freshness",
        "fresh",
      );
    });
  });

  it("EDGE: auto-update chip toggles without leaving Cost", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-tab-cost"));
    const chip = screen.getByTestId("auto-update-status-chip");
    const before = chip.getAttribute("data-state");
    fireEvent.click(chip);
    expect(screen.getByTestId("journey-tab-cost")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(chip.getAttribute("data-state")).not.toBe(before);
  });

  it("EDGE: Cost panel shows canvas full width", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-tab-cost"));
    expect(screen.getByTestId("section-results-summary")).toBeInTheDocument();
    expect(screen.getByTestId("results-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("estimator-canvas").className).toMatch(
      /estimator-canvas/,
    );
  });

  it("projection tab shows charts adjacent to table", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("cost-drivers")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("results-tab-projections"));
    await waitFor(() => {
      const panel = screen.getByTestId("results-panel-projections");
      expect(
        panel.querySelector('[data-testid="projection-charts"]') ||
          panel.querySelector('[data-testid="projection-charts-empty"]'),
      ).toBeTruthy();
      expect(
        panel.querySelector('[data-testid="projection-table"]') ||
          panel.querySelector('[data-testid="projection-table-empty"]'),
      ).toBeTruthy();
    });
  });

  it("debounce wait is ≤300ms and coalesces rapid calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, CAPABILITY_DEBOUNCE_MS);
    expect(CAPABILITY_DEBOUNCE_MS).toBeLessThanOrEqual(300);
    d();
    d();
    d();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CAPABILITY_DEBOUNCE_MS);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("capability toggles trigger debounced estimate API", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = createMockClient();
    render(<App client={client} />);
    await waitFor(() => {
      expect(screen.getByTestId("cap-toggle-adsCloud")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("cap-toggle-adsCloud"));
    expect(client.POST).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(CAPABILITY_DEBOUNCE_MS);
    });

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalled();
    });
    expect(client.POST).toHaveBeenCalledWith(
      "/estimates",
      expect.objectContaining({
        body: expect.objectContaining({
          capabilities: expect.objectContaining({ adsCloud: true }),
        }),
      }),
    );
  });

  it("number edits trigger debounced estimate API", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = createMockClient();
    render(<App client={client} />);
    await waitFor(() => {
      expect(screen.getByTestId("input-account-count")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("input-account-count"), {
      target: { value: "42" },
    });

    await act(async () => {
      vi.advanceTimersByTime(CAPABILITY_DEBOUNCE_MS);
    });

    await waitFor(() => {
      expect(client.POST).toHaveBeenCalledWith(
        "/estimates",
        expect.objectContaining({
          body: expect.objectContaining({
            volume: expect.objectContaining({ accountCount: 42 }),
          }),
        }),
      );
    });
  });

  it("auto-run toggle off suppresses recalculation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = createMockClient();
    render(<App client={client} />);
    await waitFor(() => {
      expect(screen.getByTestId("auto-run-toggle")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("auto-run-toggle"));
    expect(screen.getByTestId("auto-run-toggle")).not.toBeChecked();

    fireEvent.click(screen.getByTestId("cap-toggle-adsCloud"));
    await act(async () => {
      vi.advanceTimersByTime(CAPABILITY_DEBOUNCE_MS);
    });
    expect(client.POST).not.toHaveBeenCalled();
  });

  it("discovery-only shows empty state (no invented breakdown)", async () => {
    render(<App client={createMockClient()} />);
    await waitFor(() => {
      expect(screen.getByTestId("cap-toggle-auditLogs")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("cap-toggle-auditLogs"));
    fireEvent.click(screen.getByTestId("cap-toggle-discovery"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("discovery-only-empty")).toBeInTheDocument();
    });
    expect(isDiscoveryOnly({ discovery: true, auditLogs: false })).toBe(true);
  });

  it("API failure does not present stale cache as live success", async () => {
    clearEstimateCache();
    saveEstimateCache({
      provider: "azure",
      estimate: mockEstimate("azure", 99),
      cachedAt: new Date().toISOString(),
    });
    const client = createMockClient();
    const POST = client.POST as ReturnType<typeof vi.fn>;
    POST.mockImplementation(async (path: string) => {
      if (path === "/projections") {
        return {
          data: undefined,
          error: { detail: "skip" },
          response: new Response(null, { status: 400 }),
        };
      }
      return {
        data: undefined,
        error: { detail: "bad request" },
        response: new Response(null, { status: 400 }),
      };
    });
    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("estimate-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("summary-monthly-expected")).not.toHaveTextContent(
      "$99.00",
    );
  });

  it("section error boundary isolates failure — siblings remain", () => {
    function Boom(): never {
      throw new Error("boom-section");
    }
    render(
      <div>
        <SectionErrorBoundary sectionId="boom">
          <Boom />
        </SectionErrorBoundary>
        <p data-testid="sibling-ok">sibling</p>
      </div>,
    );
    expect(screen.getByTestId("section-boundary-boom")).toBeInTheDocument();
    expect(screen.getByTestId("sibling-ok")).toBeInTheDocument();
  });

  it("advanced calibration is progressive disclosure (closed by default)", () => {
    render(<App client={createMockClient()} />);
    expect(screen.queryByTestId("advanced-disclosure-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("advanced-disclosure-toggle"));
    expect(screen.getByTestId("advanced-disclosure-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("advanced-paste")).toBeNull();
    expect(screen.getByTestId("calibration-panel")).toBeInTheDocument();
  });
});