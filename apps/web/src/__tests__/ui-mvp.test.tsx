/**
 * Package 19 — MVP UI acceptance unit tests (mocked openapi-fetch).
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
  buildEstimateExport,
  ExportBlockedError,
  exportToCsv,
  exportToJson,
  assertNoSaasLines,
} from "../features/export-estimate/buildExport.ts";
import { parseNonNegativeOrPreset } from "../shared/lib/parse-input.ts";
import { DEMO_PRESETS } from "../features/demo-presets/demoPresets.ts";

function mockEstimate(
  provider: "azure" | "aws" | "gcp",
  opts?: { confidence?: "High" | "Med" | "Low"; low?: number; high?: number },
) {
  const expected = 12.34;
  return {
    provider,
    lineItems: [
      {
        provider,
        capability: "auditLogs",
        meterId: `${provider}-meter`,
        amount: expected,
        confidence: opts?.confidence ?? ("Med" as const),
      },
    ],
    totals: {
      expected,
      ...(opts?.low != null ? { low: opts.low, high: opts.high } : {}),
    },
    confidence: opts?.confidence ?? ("Med" as const),
    modelVersion: "0.1.0",
    ratesAsOf: "2026-07-01T00:00:00.000Z",
    inputHash: "abc",
    ratesSource: "fallback" as const,
  };
}

function createMockClient(): CostApiClient {
  const GET = vi.fn(async (path: string, init?: { params?: { query?: { provider?: string } } }) => {
    const provider = (init?.params?.query?.provider ?? "azure") as
      | "azure"
      | "aws"
      | "gcp";
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
          freshness: { level: "fresh", banner: null, requiresAckBeforeExport: false },
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

  const POST = vi.fn(async (path: string, init?: { body?: { provider?: string; capabilities?: Record<string, boolean> } }) => {
    if (path === "/projections") {
      const expected = 12.34;
      const series = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        expected,
        cumulative: expected * (i + 1),
        volumeIndex: 1,
        ...(Boolean(init?.body?.capabilities) ? {} : {}),
      }));
      return {
        data: {
          series,
          table: series,
          total: expected * 12,
          monthlyBaseline: expected,
          annualGrowthPercent: 0,
          modelVersion: "0.1.0",
          disclaimer:
            "Indicative projection only. Does not imply reserved instance, savings plans, or CUD pricing.",
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    const provider = (init?.body?.provider ?? "azure") as "azure" | "aws" | "gcp";
    const caps = init?.body?.capabilities ?? {};
    if (caps.discovery && !caps.auditLogs && !caps.dspm) {
      return {
        data: {
          ...mockEstimate(provider),
          lineItems: [],
          totals: { expected: 0 },
          confidence: "High",
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    const lowConf = Boolean(caps.dspm);
    return {
      data: mockEstimate(provider, {
        confidence: lowConf ? "Low" : "Med",
        low: lowConf ? 6.17 : undefined,
        high: lowConf ? 24.68 : undefined,
      }),
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return { GET, POST } as unknown as CostApiClient;
}

describe("package 19 — UI MVP acceptance", () => {
  beforeEach(() => {
    clearEstimateCache();
    sessionStorage.setItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => cleanup());

  it("demo presets exist for all three providers × audit + comprehensive", () => {
    const ids = DEMO_PRESETS.map((p) => p.id);
    for (const cloud of ["azure", "aws", "gcp"]) {
      expect(ids).toContain(`${cloud}-audit`);
      expect(ids).toContain(`${cloud}-comprehensive`);
    }
  });

  it("switching provider updates region options", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    fireEvent.click(screen.getByRole("radio", { name: "AWS" }));
    await waitFor(() => {
      expect(screen.getByTestId("region-select")).toHaveValue("us-east-1");
      expect(screen.getByTestId("summary-provider")).toHaveTextContent(/AWS/);
    });
  });

  it("capability toggles update breakdown via estimate", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    await waitFor(() => {
      expect(screen.getByTestId("cost-drivers")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("result-flip-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("cost-breakdown")).toBeInTheDocument();
    });
    expect(client.POST).toHaveBeenCalled();
  });

  it("export JSON includes provider, modelVersion, ratesAsOf, disclaimer, meter rows", () => {
    const payload = buildEstimateExport(mockEstimate("gcp"));
    assertNoSaasLines(payload);
    const json = exportToJson(payload);
    expect(json).toContain('"provider": "gcp"');
    expect(json).toContain('"modelVersion": "0.1.0"');
    expect(json).toContain('"ratesAsOf"');
    expect(json).toContain("disclaimer");
    const csv = exportToCsv(payload);
    expect(csv).toContain("meterId");
    expect(csv).toContain("confidence");
    expect(csv).toContain("gcp-meter");
  });

  it("critical-stale blocks export without ack", () => {
    expect(() =>
      buildEstimateExport(mockEstimate("azure"), {
        freshness: { level: "critical", requiresAckBeforeExport: true },
        ackCriticalStale: false,
      }),
    ).toThrow(ExportBlockedError);

    const ok = buildEstimateExport(mockEstimate("azure"), {
      freshness: { level: "critical", requiresAckBeforeExport: true },
      ackCriticalStale: true,
    });
    expect(ok.provider).toBe("azure");
  });

  it("empty advanced numeric field uses preset not silent zero; invalid fails closed", () => {
    expect(parseNonNegativeOrPreset("", 10, "ingress").ok).toBe(true);
    expect(
      (parseNonNegativeOrPreset("", 10, "ingress") as { value: number }).value,
    ).toBe(10);
    expect(parseNonNegativeOrPreset("abc", 10, "ingress").ok).toBe(false);
    expect(parseNonNegativeOrPreset("-1", 10, "ingress").ok).toBe(false);
  });

  it("demo preset button is present for azure-audit", async () => {
    render(<App client={createMockClient()} />);
    expect(screen.getByTestId("demo-preset-azure-audit")).toBeInTheDocument();
    expect(
      screen.getByTestId("demo-preset-gcp-comprehensive"),
    ).toBeInTheDocument();
  });

  it("Low confidence is visible in summary when bands present", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("demo-preset-azure-comprehensive"));
    await waitFor(() => {
      expect(screen.getByTestId("summary-confidence")).toHaveTextContent("Low");
      expect(screen.getByTestId("summary-bands")).toBeInTheDocument();
    });
  });
});
