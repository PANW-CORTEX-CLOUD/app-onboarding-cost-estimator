/**
 * Package 20 — graphs & projections UI tests (mocked openapi-fetch).
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
import { buildEstimateExport } from "../features/export-estimate/buildExport.ts";

function mockEstimate(provider: "azure" | "aws" | "gcp" = "azure") {
  return {
    provider,
    lineItems: [
      {
        provider,
        capability: "auditLogs",
        meterId: "eh-standard-tu",
        amount: 40,
        confidence: "Med" as const,
      },
      {
        provider,
        capability: "auditLogs",
        meterId: "eh-standard-ingress-events",
        amount: 60,
        confidence: "Med" as const,
      },
    ],
    totals: { expected: 100, low: 50, high: 200 },
    confidence: "Med" as const,
    modelVersion: "0.1.0",
    ratesAsOf: "2026-07-01T00:00:00.000Z",
    inputHash: "abc",
    ratesSource: "fallback" as const,
  };
}

function mockProjection(months = 12) {
  const series = Array.from({ length: months }, (_, i) => {
    const expected = 100;
    return {
      month: i + 1,
      expected,
      cumulative: expected * (i + 1),
      volumeIndex: 1,
      stacks: [
        {
          provider: "azure",
          capability: "auditLogs",
          meterId: "eh-standard-tu",
          amount: 40,
          confidence: "Med",
        },
        {
          provider: "azure",
          capability: "auditLogs",
          meterId: "eh-standard-ingress-events",
          amount: 60,
          confidence: "Med",
        },
      ],
    };
  });
  return {
    series,
    table: series,
    total: 100 * months,
    monthlyBaseline: 100,
    annualGrowthPercent: 0,
    modelVersion: "0.1.0",
    provider: "azure" as const,
    disclaimer:
      "Indicative projection only. Does not imply reserved instance, savings plans, or CUD pricing.",
  };
}

function createMockClient(): CostApiClient {
  const GET = vi.fn(async (path: string, init?: { params?: { query?: { provider?: string } } }) => {
    const provider = init?.params?.query?.provider ?? "azure";
    if (path === "/rates") {
      return {
        data: {
          provider,
          region: "eastus",
          currency: "USD",
          unitPrices: {},
          ratesAsOf: "2026-07-01T00:00:00.000Z",
          ratesSource: "fallback",
          ageDays: 1,
          modelVersion: "0.1.0",
          freshness: {
            level: "warn",
            banner: "Rates aging",
            requiresAckBeforeExport: false,
          },
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
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

  const POST = vi.fn(async (path: string, init?: { body?: Record<string, unknown> }) => {
    if (path === "/projections") {
      const months = Number(init?.body?.months ?? 12);
      return {
        data: mockProjection(months),
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    return {
      data: mockEstimate("azure"),
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return { GET, POST } as unknown as CostApiClient;
}

describe("package 20 — graphs & projections UI", () => {
  beforeEach(() => {
    clearEstimateCache();
    sessionStorage.setItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => cleanup());

  it("default 12-month stacked + cumulative charts and a11y table", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("run-estimate"));

    await waitFor(() => {
      expect(screen.getByTestId("cost-drivers")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("results-tab-projections"));

    await waitFor(() => {
      expect(screen.getByTestId("chart-stacked")).toBeInTheDocument();
      expect(screen.getByTestId("chart-cumulative")).toBeInTheDocument();
      expect(screen.getByTestId("chart-volume")).toBeInTheDocument();
      expect(screen.getByTestId("projection-table")).toBeInTheDocument();
      expect(screen.getByTestId("projection-months")).toHaveValue(12);
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/projections",
      expect.objectContaining({
        body: expect.objectContaining({ months: 12 }),
      }),
    );

    // table same numbers as series
    expect(screen.getByTestId("proj-expected-1")).toHaveTextContent("$100");
    expect(screen.getByTestId("proj-cumulative-12")).toHaveTextContent(
      "$1,200",
    );
  });

  it("capability legend and hover surface meter details", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("cost-drivers")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("results-tab-projections"));
    await waitFor(() => {
      expect(screen.getByTestId("projection-legend")).toBeInTheDocument();
    });
    fireEvent.mouseEnter(screen.getByTestId("stack-1-eh-standard-tu"));
    expect(screen.getByTestId("projection-hover")).toHaveTextContent(
      /Period 1.*eh-standard-tu/i,
    );
  });

  it("export includes projection.series (AC)", () => {
    const payload = buildEstimateExport(mockEstimate(), {
      projection: {
        series: mockProjection(3).series.map((p) => ({
          month: p.month,
          expected: p.expected,
          cumulative: p.cumulative,
          volumeIndex: p.volumeIndex,
        })),
        total: 300,
        annualGrowthPercent: 0,
        disclaimer: mockProjection().disclaimer,
      },
    });
    expect(payload.projection?.series).toHaveLength(3);
    expect(payload.projection?.series[2]?.cumulative).toBe(300);
  });

  it("rates warn surfaces single freshness banner", async () => {
    render(<App client={createMockClient()} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("estimate-freshness-banner")).toHaveAttribute(
        "data-freshness",
        "warn",
      );
    });
    fireEvent.click(screen.getByTestId("results-tab-projections"));
    await waitFor(() => {
      expect(screen.getByTestId("projection-disclaimer").textContent).toMatch(
        /does not imply reserved/i,
      );
    });
  });
});
