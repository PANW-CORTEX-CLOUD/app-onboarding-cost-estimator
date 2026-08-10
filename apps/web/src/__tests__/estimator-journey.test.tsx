/**
 * Estimator UX journey — Inputs wizard vs Cost output (REQ/AC/TEST/EDGE).
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
import { clearEstimateCache } from "../shared/lib/estimate-cache.ts";
import { ESTIMATOR_BOOTSTRAP_SESSION_KEY } from "../shared/lib/estimator-bootstrap.ts";
import { CAPABILITY_DEBOUNCE_MS } from "../shared/lib/debounce.ts";
import {
  readJourneyViewFromSearch,
  writeJourneyViewToUrl,
} from "../shared/lib/journey-view.ts";
import { missingJourneyFields } from "../widgets/JourneyChecklist/JourneyChecklist.tsx";

function mockEstimate(provider: "azure" | "aws" | "gcp", amount = 12.34) {
  return {
    provider,
    lineItems: [
      {
        provider,
        capability: "audit_logs",
        meterId: "eh-standard-tu",
        amount,
        confidence: "High" as const,
      },
    ],
    totals: { expected: amount, low: amount * 0.9, high: amount * 1.1 },
    confidence: "High" as const,
    modelVersion: "0.1.3",
    ratesAsOf: "2026-07-01T00:00:00.000Z",
    inputHash: "abc",
    ratesSource: "fallback" as const,
    warnings: [],
  };
}

function createMockClient(): CostApiClient {
  const GET = vi.fn(async () => ({
    data: {
      provider: "azure",
      capabilities: [
        {
          capability: "auditLogs",
          meterId: "azure-audit",
          confidence: "High" as const,
          sourceUrl: "https://example.com",
        },
      ],
    },
    error: undefined,
    response: new Response(null, { status: 200 }),
  }));

  const POST = vi.fn(async (path: string, init?: { body?: { provider?: string } }) => {
    if (path === "/projections") {
      return {
        data: {
          series: [],
          table: [],
          total: 0,
          monthlyBaseline: 12.34,
          annualGrowthPercent: 0,
          modelVersion: "0.1.3",
          disclaimer: "Indicative",
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    const provider = (init?.body?.provider ?? "azure") as "azure" | "aws" | "gcp";
    return {
      data: mockEstimate(provider),
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return { GET, POST } as unknown as CostApiClient;
}

describe("estimator journey UX", () => {
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

  it("[TEST] mode tabs switch Inputs ↔ Cost with aria-selected", () => {
    render(<App client={createMockClient()} />);
    const inputsTab = screen.getByTestId("journey-tab-inputs");
    const costTab = screen.getByTestId("journey-tab-cost");
    expect(inputsTab).toHaveAttribute("aria-selected", "true");
    expect(costTab).toHaveAttribute("aria-selected", "false");
    fireEvent.click(costTab);
    expect(costTab).toHaveAttribute("aria-selected", "true");
    expect(inputsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("journey-panel-cost")).not.toHaveAttribute(
      "hidden",
    );
  });

  it("[TEST] Continue/Back advances Start→Size→Run", () => {
    render(<App client={createMockClient()} />);
    expect(screen.getByTestId("journey-step-progress").textContent).toMatch(
      /Step 1 of 3/,
    );
    fireEvent.click(screen.getByTestId("journey-step-continue"));
    expect(screen.getByTestId("journey-step-progress").textContent).toMatch(
      /Step 2 of 3/,
    );
    fireEvent.click(screen.getByTestId("journey-step-continue"));
    expect(screen.getByTestId("journey-step-progress").textContent).toMatch(
      /Step 3 of 3/,
    );
    fireEvent.click(screen.getByTestId("journey-step-back"));
    expect(screen.getByTestId("journey-step-progress").textContent).toMatch(
      /Step 2 of 3/,
    );
  });

  it("[TEST] Run switches to Cost with summary amount", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("journey-tab-cost")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("summary-monthly-expected").textContent).toMatch(
        /\$12\.34/,
      );
    });
  });

  it("[TEST] debounce auto-update keeps Inputs mode", async () => {
    vi.useFakeTimers();
    render(<App client={createMockClient()} />);
    expect(screen.getByTestId("journey-tab-inputs")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const region = screen.getByTestId("region-select");
    fireEvent.change(region, { target: { value: "westus" } });
    await act(async () => {
      vi.advanceTimersByTime(CAPABILITY_DEBOUNCE_MS + 50);
    });
    expect(screen.getByTestId("journey-tab-inputs")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("[TEST] empty Cost CTA goes to Inputs", () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-tab-cost"));
    const go = screen.queryByTestId("cost-empty-go-inputs");
    if (go) {
      fireEvent.click(go);
      expect(screen.getByTestId("journey-tab-inputs")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
  });

  it("[TEST] Continue absent on last step; no view-cost; Run primary", () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    expect(screen.queryByTestId("journey-step-continue")).toBeNull();
    expect(screen.getByTestId("journey-step-back")).toBeInTheDocument();
    expect(screen.getByTestId("run-estimate")).toBeInTheDocument();
    expect(screen.queryByTestId("view-cost-output")).toBeNull();
    expect(screen.queryByTestId("retry-estimate")).toBeNull();
    expect(screen.getByTestId("auto-run-toggle")).toBeInTheDocument();
  });

  it("[TEST] auto-chip toggles auto-run without leaving Cost", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("journey-tab-cost")).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    const chip = screen.getByTestId("auto-update-status-chip");
    expect(chip).toHaveAttribute("data-state", "on");
    fireEvent.click(chip);
    expect(screen.getByTestId("journey-tab-cost")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(chip).toHaveAttribute("data-state", "off");
  });

  it("[TEST] driver jump opens Inputs Size and focuses peak", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("cost-drivers")).toBeInTheDocument();
    });
    const why = screen.getByTestId("driver-why-audit_logs");
    if (!(why as HTMLDetailsElement).open) {
      fireEvent.click(why.querySelector("summary")!);
    }
    const jump = screen.getByTestId("jump-audit_logs-input-peak-mbps");
    fireEvent.click(jump);
    await waitFor(() => {
      expect(screen.getByTestId("journey-tab-inputs")).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("journey-step-progress").textContent).toMatch(
        /Step 2 of 3/,
      );
    });
    expect(screen.getByTestId("journey-step-panel-size")).not.toHaveAttribute(
      "hidden",
    );
  });

  it("[TEST] demo presets are chips only (no select)", () => {
    render(<App client={createMockClient()} />);
    const group = screen.getByTestId("demo-presets");
    expect(group.tagName).not.toBe("SELECT");
    expect(group.querySelector("select")).toBeNull();
    expect(screen.getByTestId("demo-preset-azure-audit")).toBeInTheDocument();
  });

  it("[EDGE] invalid ?view= falls back to inputs", () => {
    expect(readJourneyViewFromSearch("?view=nope")).toBe("inputs");
    expect(readJourneyViewFromSearch("?view=")).toBe("inputs");
    expect(readJourneyViewFromSearch("?view=cost")).toBe("cost");
    window.history.replaceState({}, "", "/?view=cost");
    writeJourneyViewToUrl("inputs");
    expect(window.location.search).toMatch(/view=inputs/);
  });

  it("[EDGE] DSPM missing estate listed in checklist; no invent", () => {
    const missing = missingJourneyFields(
      {
        discovery: false,
        auditLogs: false,
        adsCloud: false,
        adsOutpost: false,
        dspm: true,
        registry: false,
        serverless: false,
        egress: false,
      },
      {
        dataEstateGB: 0,
        vmCount: 0,
        avgUsedDiskGB: 0,
        imageCount: 0,
        avgImageGB: 0,
        packageCount: 0,
        egressGB: 0,
      },
    );
    expect(missing.some((m) => /DSPM/i.test(m))).toBe(true);
  });

  it("[EDGE] canvas is not sticky", () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("journey-tab-cost"));
    const canvas = screen.getByTestId("estimator-canvas");
    expect(getComputedStyle(canvas).position).not.toBe("sticky");
  });

  it("[EDGE] dual tablists have distinct aria-labels", () => {
    render(<App client={createMockClient()} />);
    expect(screen.getByRole("tablist", { name: "Journey" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("journey-tab-cost"));
    expect(
      screen.getByRole("tablist", { name: "Results views" }),
    ).toBeInTheDocument();
  });

  it("[AC] one results-summary only in Cost mode", () => {
    render(<App client={createMockClient()} />);
    expect(screen.getAllByTestId("results-summary")).toHaveLength(1);
    expect(
      screen.getByTestId("journey-panel-cost").contains(
        screen.getByTestId("results-summary"),
      ),
    ).toBe(true);
  });
});
