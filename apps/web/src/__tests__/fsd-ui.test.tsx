/**
 * Package 17 — FSD UI component + feature tests (openapi-fetch mocked).
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
import {
  clearEstimateCache,
  saveEstimateCache,
} from "../shared/lib/estimate-cache.ts";
import {
  readProviderFromSearch,
  writeProviderToUrl,
} from "../shared/lib/url-state.ts";
import { runEstimate } from "../features/run-estimate/runEstimate.ts";
import { ProviderSelector } from "../widgets/ProviderSelector/ProviderSelector.tsx";
import { ESTIMATOR_BOOTSTRAP_SESSION_KEY } from "../shared/lib/estimator-bootstrap.ts";
import {
  SHARE_LAST_KEY,
  saveLastShareState,
} from "../shared/lib/safe-storage.ts";

function mockEstimate(provider: "azure" | "aws" | "gcp") {
  return {
    provider,
    lineItems: [
      {
        provider,
        capability: "auditLogs",
        meterId: "meter-1",
        amount: 12.34,
        confidence: "Med" as const,
      },
    ],
    totals: { expected: 12.34 },
    confidence: "Med" as const,
    modelVersion: "0.1.0",
    ratesAsOf: "2026-07-01T00:00:00.000Z",
    inputHash: "abc",
    ratesSource: "fallback" as const,
  };
}

function createMockClient(opts?: {
  estimateFail?: boolean;
  capsByProvider?: Record<string, { capability: string; meterId: string }[]>;
}): CostApiClient {
  const capsByProvider = opts?.capsByProvider ?? {
    azure: [{ capability: "auditLogs", meterId: "az-audit" }],
    aws: [{ capability: "auditLogs", meterId: "aws-cloudtrail" }],
    gcp: [{ capability: "auditLogs", meterId: "gcp-audit" }],
  };

  const GET = vi.fn(async (_path: string, init?: { params?: { query?: { provider?: string } } }) => {
    const provider = init?.params?.query?.provider ?? "azure";
    const rows = capsByProvider[provider] ?? [];
    return {
      data: {
        provider,
        capabilities: rows.map((r) => ({
          ...r,
          confidence: "Med" as const,
          sourceUrl: "https://example.com",
        })),
      },
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  const POST = vi.fn(async (path: string, init?: { body?: { provider?: string } }) => {
    if (path === "/projections") {
      const months = 12;
      const expected = 12.34;
      const series = Array.from({ length: months }, (_, i) => ({
        month: i + 1,
        expected,
        cumulative: expected * (i + 1),
        volumeIndex: 1,
      }));
      return {
        data: {
          series,
          table: series,
          total: expected * months,
          monthlyBaseline: expected,
          annualGrowthPercent: 0,
          modelVersion: "0.1.0",
          disclaimer: "Indicative projection only. Does not imply reserved instance, savings plans, or CUD pricing.",
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    }
    if (opts?.estimateFail) {
      return {
        data: undefined,
        error: { title: "boom" },
        response: new Response(null, { status: 500 }),
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

describe("package 17 — FSD UI", () => {
  beforeEach(() => {
    clearEstimateCache();
    // Skip first-run Azure bootstrap so provider-selection tests stay deterministic.
    sessionStorage.setItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY);
  });

  it("run-estimate calls createEstimate with selected provider", async () => {
    const client = createMockClient();
    render(<App client={client} />);

    fireEvent.click(screen.getByTestId("journey-step-tab-start"));

    fireEvent.click(screen.getByRole("radio", { name: "AWS" }));
    fireEvent.click(screen.getByTestId("run-estimate"));

    await waitFor(() => {
      expect(screen.getByTestId("summary-monthly-expected")).toHaveTextContent(
        "$12.34",
      );
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/estimates",
      expect.objectContaining({
        body: expect.objectContaining({ provider: "aws" }),
      }),
    );
  });

  it("URL state includes provider after selection", async () => {
    const client = createMockClient();
    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("journey-step-tab-start"));
    fireEvent.click(screen.getByRole("radio", { name: "GCP" }));
    expect(readProviderFromSearch(window.location.search)).toBe("gcp");
    expect(window.location.search).toContain("provider=gcp");
  });

  it("writeProviderToUrl is round-trip safe", () => {
    writeProviderToUrl("azure");
    expect(readProviderFromSearch(window.location.search)).toBe("azure");
  });

  it("switching provider refetches capabilities API", async () => {
    const client = createMockClient();
    render(<App client={client} />);

    fireEvent.click(screen.getByTestId("journey-step-tab-start"));

    fireEvent.click(screen.getByRole("radio", { name: "AWS" }));

    await waitFor(() => {
      expect(screen.getByTestId("region-select")).toHaveValue("us-east-1");
    });
    expect(client.GET).toHaveBeenCalledWith(
      "/capabilities",
      expect.objectContaining({
        params: { query: { provider: "aws" } },
      }),
    );
  });

  it("ProviderSelector is keyboard accessible (arrow keys)", () => {
    const onChange = vi.fn();
    render(<ProviderSelector value="azure" onChange={onChange} />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("aws");
  });

  it("runEstimate fails closed on API error", async () => {
    const client = createMockClient({ estimateFail: true });
    await expect(
      runEstimate(client, {
        provider: "azure",
        region: "eastus",
        capabilities: { auditLogs: true },
      }),
    ).rejects.toThrow(/Estimate request failed/);
  });

  it("API failure shows error without auto-stale success", async () => {
    saveEstimateCache({
      provider: "azure",
      estimate: mockEstimate("azure"),
      cachedAt: "2026-07-01T00:00:00.000Z",
    });
    const client = createMockClient({ estimateFail: true });
    render(<App client={client} />);

    fireEvent.click(screen.getByTestId("run-estimate"));

    await waitFor(() => {
      expect(screen.getByTestId("estimate-error")).toBeInTheDocument();
      expect(screen.getByTestId("load-cached-estimate")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("cached-estimate-note")).toBeNull();
    expect(screen.getByTestId("run-estimate")).toHaveTextContent(
      /Retry estimate/,
    );
    expect(screen.getByTestId("run-estimate")).not.toBeDisabled();
    expect(screen.queryByTestId("retry-estimate")).toBeNull();
  });

  it("offline engine only via explicit toggle — uses cache, never silent API skip", async () => {
    saveEstimateCache({
      provider: "azure",
      estimate: mockEstimate("azure"),
      cachedAt: "2026-07-01T00:00:00.000Z",
    });
    const client = createMockClient();
    render(<App client={client} />);

    fireEvent.click(screen.getByTestId("offline-engine-toggle"));
    fireEvent.click(screen.getByTestId("run-estimate"));

    await waitFor(() => {
      expect(screen.getByTestId("estimate-freshness-banner")).toHaveAttribute(
        "data-freshness",
        "stale-cache",
      );
    });
    expect(client.POST).not.toHaveBeenCalledWith(
      "/estimates",
      expect.anything(),
    );
    expect(window.location.search).toContain("offlineEngine=1");
  });
});

describe("freeze rates snapshot", () => {
  beforeEach(() => {
    clearEstimateCache();
    sessionStorage.setItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY, "1");
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY);
  });

  it("calls the freeze endpoint and shows the server-pinned metadata", async () => {
    // The button used to only stamp ratesAsOf/modelVersion client-side, so it
    // pinned nothing and the quote could not be reproduced. It must now reach
    // the API and render what the server actually froze.
    const client = createMockClient();
    const basePost = (
      client.POST as unknown as {
        getMockImplementation: () => (path: string, init?: unknown) => unknown;
      }
    ).getMockImplementation();
    (client.POST as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string, init?: unknown) => {
        if (path === "/estimates/freeze") {
          return {
            data: {
              schemaVersion: 1,
              provider: "azure",
              modelVersion: "9.9.9",
              ratesAsOf: "2026-07-01T00:00:00.000Z",
              inputHash: "cafebabe",
              frozenAt: "2026-08-10T00:00:00.000Z",
              rateCard: {
                provider: "azure",
                region: "eastus",
                currency: "USD",
                unitPrices: { "eh-standard-tu": 0.03 },
                capturedAt: "2026-07-01T00:00:00.000Z",
              },
              inputs: {},
              lineItems: [],
              totals: { expected: 12.34 },
              confidence: "Med",
              disclaimer: "x".repeat(30),
              warnings: [],
            },
            error: undefined,
            response: new Response(null, { status: 200 }),
          };
        }
        return basePost(path, init);
      },
    );

    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    // The freeze button lives in the collapsed "Assumptions & run" step.
    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    await waitFor(() => {
      expect(screen.getByTestId("freeze-rates")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("freeze-rates"));

    await waitFor(() => {
      expect(screen.getByTestId("frozen-meta")).toHaveTextContent("9.9.9");
    });
    expect(client.POST).toHaveBeenCalledWith(
      "/estimates/freeze",
      expect.objectContaining({
        body: expect.objectContaining({ provider: "azure" }),
      }),
    );
  });

  it("EDGE: a failed freeze surfaces an error instead of claiming success", async () => {
    const client = createMockClient();
    const basePost = (
      client.POST as unknown as {
        getMockImplementation: () => (path: string, init?: unknown) => unknown;
      }
    ).getMockImplementation();
    (client.POST as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string, init?: unknown) => {
        if (path === "/estimates/freeze") {
          return {
            data: undefined,
            error: {
              status: 400,
              title: "Freeze failed",
              detail: "critical-stale rates require Ack before export",
            },
            response: new Response(null, { status: 400 }),
          };
        }
        return basePost(path, init);
      },
    );

    render(<App client={client} />);
    fireEvent.click(screen.getByTestId("run-estimate"));
    // The freeze button lives in the collapsed "Assumptions & run" step.
    fireEvent.click(screen.getByTestId("journey-step-tab-run"));
    await waitFor(() => {
      expect(screen.getByTestId("freeze-rates")).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId("freeze-rates"));

    await waitFor(() => {
      expect(screen.getByTestId("freeze-error")).toHaveTextContent(
        /require Ack/i,
      );
    });
    expect(screen.queryByTestId("frozen-meta")).toBeNull();
  });
});

describe("last-shared-state restore on cold load", () => {
  beforeEach(() => {
    clearEstimateCache();
    localStorage.removeItem(SHARE_LAST_KEY);
    // Cold load: no bootstrap sentinel, so the restore/demo-preset branch runs.
    sessionStorage.removeItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY);
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(SHARE_LAST_KEY);
    sessionStorage.removeItem(ESTIMATOR_BOOTSTRAP_SESSION_KEY);
  });

  it("restores the last shared inputs instead of the first-run demo preset", async () => {
    saveLastShareState({
      v: 1,
      provider: "gcp",
      region: "us-central1",
      capabilities: { auditLogs: true },
      volume: { accountCount: 42 },
    });
    render(<App client={createMockClient()} />);
    await waitFor(() => {
      expect(readProviderFromSearch(window.location.search)).toBe("gcp");
    });
  });

  it("restores the sound parts of a partly-invalid saved blob and drops the rest", async () => {
    // EDGE: written by an older build, or hand-edited. validateShareState is
    // an allowlist, so a bad field is dropped and named rather than sinking
    // the whole restore - the provider still comes back, the negative estate
    // does not reach a state setter.
    saveLastShareState({
      v: 1,
      provider: "gcp",
      region: "us-central1",
      capabilities: { auditLogs: true },
      volume: { accountCount: 7, dataEstateGB: -999 },
    });
    render(<App client={createMockClient()} />);
    await waitFor(() => {
      expect(readProviderFromSearch(window.location.search)).toBe("gcp");
    });
    await waitFor(() => {
      expect(screen.getByTestId("share-message")).toHaveTextContent(
        /Ignored invalid dataEstateGB/,
      );
    });
  });
});
