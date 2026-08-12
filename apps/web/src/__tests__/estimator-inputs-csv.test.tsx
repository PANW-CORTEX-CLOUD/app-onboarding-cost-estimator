/**
 * Package 01/01 — estimator inputs CSV export/import (REQ/AC/TEST/EDGE).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  INPUTS_CSV_FORMAT,
  INPUTS_CSV_FORMAT_VERSION,
  INPUTS_CSV_MAX_BYTES,
  customerPlanTemplateCsv,
  exportEstimatorInputsCsv,
  parseEstimatorInputsCsv,
  type EstimatorInputsState,
} from "../features/estimator-inputs-csv/estimatorInputsCsv.ts";
import { InputsCsvPanel } from "../widgets/InputsCsvPanel/InputsCsvPanel.tsx";

afterEach(() => {
  cleanup();
});

const sample: EstimatorInputsState = {
  provider: "azure",
  region: "eastus",
  capabilities: {
    discovery: false,
    auditLogs: true,
    adsCloud: false,
    adsOutpost: false,
    dspm: false,
    registry: false,
    serverless: false,
    egress: false,
  },
  volume: {
    accountCount: 10,
    monthlyActiveUsers: 1000,
    ingressGBPerDay: 10,
    peakMBps: 1,
    peakEventsPerSec: 1000,
    overrideStreamMetrics: true,
    crossRegionPull: false,
    dataEstateGB: 0,
    pctScanned: 0,
    scansPerMonth: 0,
    imageCount: 0,
    avgImageGB: 0,
    packageCount: 0,
    egressGB: 0,
    vmCount: 0,
    avgUsedDiskGB: 0,
  },
  assumptions: {
    monthHours: 730,
    assumedEventBytes: 1024,
    avgStoredGB: 0,
    logIntensity: "medium",
  },
};

describe("[01/01][REQ]+[AC] inputs CSV round-trip", () => {
  it("export → parse equals original allowlisted state", () => {
    const csv = exportEstimatorInputsCsv(sample);
    expect(csv).toMatch(/^key,value\n/);
    expect(csv).toContain(`format,${INPUTS_CSV_FORMAT}`);
    expect(csv).toContain(`formatVersion,${INPUTS_CSV_FORMAT_VERSION}`);
    const parsed = parseEstimatorInputsCsv(csv);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state).toEqual(sample);
    expect(parsed.keyCount).toBeGreaterThan(10);
  });

  it("does not put meter amounts in export", () => {
    const csv = exportEstimatorInputsCsv(sample);
    expect(csv).not.toMatch(/meterId|eh-standard-tu|amount/i);
  });
});

describe("[01/01][TEST] InputsCsvPanel apply", () => {
  it("import calls onImport with parsed state", async () => {
    const onImport = vi.fn();
    render(
      <InputsCsvPanel getState={() => sample} onImport={onImport} />,
    );
    expect(screen.getByTestId("download-inputs-csv")).toBeInTheDocument();

    const csv = exportEstimatorInputsCsv({
      ...sample,
      provider: "aws",
      region: "us-east-1",
      volume: { ...sample.volume, peakMBps: 3 },
    });
    const file = new File([csv], "inputs.csv", { type: "text/csv" });
    const input = screen.getByTestId("import-inputs-csv");
    fireEvent.change(input, { target: { files: [file] } });

    await vi.waitFor(() => {
      expect(onImport).toHaveBeenCalled();
    });
    const [state, keyCount] = onImport.mock.calls[0]!;
    expect(state.provider).toBe("aws");
    expect(state.region).toBe("us-east-1");
    expect(state.volume.peakMBps).toBe(3);
    expect(keyCount).toBeGreaterThan(0);
    expect(screen.getByTestId("inputs-csv-status").textContent).toMatch(
      /Imported/,
    );
  });
});

describe("[01/01][EDGE] fail-closed parsers", () => {
  it("rejects empty file", () => {
    const r = parseEstimatorInputsCsv("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Empty/i);
  });

  it("rejects wrong header", () => {
    const r = parseEstimatorInputsCsv("a,b\nformat,x\n");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/key,value/);
  });

  it("rejects missing format / wrong formatVersion", () => {
    const noFormat = parseEstimatorInputsCsv(
      "key,value\nformatVersion,1\nprovider,azure\nregion,eastus\n",
    );
    expect(noFormat.ok).toBe(false);

    const badVer = parseEstimatorInputsCsv(
      `key,value\nformat,${INPUTS_CSV_FORMAT}\nformatVersion,99\nprovider,azure\nregion,eastus\ncapability.auditLogs,true\nvolume.accountCount,1\nvolume.ingressGBPerDay,1\nvolume.peakMBps,1\nvolume.peakEventsPerSec,1\nvolume.overrideStreamMetrics,true\nassumption.monthHours,730\nassumption.assumedEventBytes,1024\nassumption.avgStoredGB,0\nassumption.logIntensity,medium\n`,
    );
    expect(badVer.ok).toBe(false);
    if (badVer.ok) return;
    expect(badVer.errors.join(" ")).toMatch(/formatVersion/);
  });

  it("rejects unknown keys", () => {
    const csv =
      exportEstimatorInputsCsv(sample).trimEnd() + "\nvolume.inventedPrice,9\n";
    const r = parseEstimatorInputsCsv(csv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/Unknown key/);
  });

  it("rejects results CSV shape", () => {
    const r = parseEstimatorInputsCsv(
      "provider,capability,meterId,amount,confidence\nazure,audit_logs,eh-standard-tu,21.9,High\n",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/results/i);
  });

  it("rejects billing calibration CSV shape", () => {
    const r = parseEstimatorInputsCsv(
      "MeterCategory,CostInBillingCurrency\nEvent Hubs,12.5\n",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/billing/i);
  });

  it("rejects partial volume without required keys", () => {
    const r = parseEstimatorInputsCsv(
      `key,value\nformat,${INPUTS_CSV_FORMAT}\nformatVersion,1\nprovider,azure\nregion,eastus\ncapability.auditLogs,true\nvolume.peakMBps,2\nassumption.monthHours,730\nassumption.assumedEventBytes,1024\nassumption.avgStoredGB,0\nassumption.logIntensity,medium\n`,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/volume\.accountCount|Missing required/);
  });

  it("rejects bad boolean / number", () => {
    let csv = exportEstimatorInputsCsv(sample).replace(
      "volume.overrideStreamMetrics,true",
      "volume.overrideStreamMetrics,yes",
    );
    let r = parseEstimatorInputsCsv(csv);
    expect(r.ok).toBe(false);

    csv = exportEstimatorInputsCsv(sample).replace(
      "volume.peakMBps,1",
      "volume.peakMBps,-1",
    );
    r = parseEstimatorInputsCsv(csv);
    expect(r.ok).toBe(false);
  });

  it("rejects oversized payload", () => {
    const big = "x".repeat(INPUTS_CSV_MAX_BYTES + 10);
    const r = parseEstimatorInputsCsv(big, big.length);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/cap/i);
  });

  it("RTL: import errors surface for results CSV", async () => {
    const onImport = vi.fn();
    render(<InputsCsvPanel getState={() => sample} onImport={onImport} />);
    const bad = new File(
      ["provider,capability,meterId,amount\na,b,c,1\n"],
      "results.csv",
      { type: "text/csv" },
    );
    fireEvent.change(screen.getByTestId("import-inputs-csv"), {
      target: { files: [bad] },
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("inputs-csv-errors")).toBeInTheDocument();
    });
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe("REQ-21 — customer plan-file template", () => {
  it("the template parses cleanly into a valid state (no errors)", () => {
    const csv = customerPlanTemplateCsv();
    const parsed = parseEstimatorInputsCsv(csv);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("; ")).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.provider).toBe("azure");
    expect(parsed.state.region).toBe("eastus");
    // The example prices a real estate so an unedited upload shows a cost.
    expect(parsed.state.capabilities.auditLogs).toBe(true);
    expect(parsed.state.capabilities.dspm).toBe(true);
    expect(parsed.state.volume.dataEstateGB).toBeGreaterThan(0);
  });

  it("carries # comment lines that the parser ignores", () => {
    const csv = customerPlanTemplateCsv();
    expect(csv).toMatch(/^# /m); // has comment lines
    expect(csv).toMatch(/docs\/CUSTOMER_PLAN_FILE\.md/); // points to the spec
    // Round-trip: comments do not leak into any parsed key.
    const parsed = parseEstimatorInputsCsv(csv);
    expect(parsed.ok).toBe(true);
  });

  it("EDGE: a customer edit (capabilities + numbers) is reflected after import", () => {
    // Simulate the real flow: customer opens the template, flips DSPM off and
    // enables registry, changes accountCount and image inputs.
    const edited = customerPlanTemplateCsv()
      .replace("capability.dspm,true", "capability.dspm,false")
      .replace("capability.registry,false", "capability.registry,true")
      .replace("volume.accountCount,25", "volume.accountCount,120")
      .replace("volume.imageCount,0", "volume.imageCount,500")
      .replace("volume.avgImageGB,0", "volume.avgImageGB,0.4");
    const parsed = parseEstimatorInputsCsv(edited);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("; ")).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.capabilities.dspm).toBe(false);
    expect(parsed.state.capabilities.registry).toBe(true);
    expect(parsed.state.volume.accountCount).toBe(120);
    expect(parsed.state.volume.imageCount).toBe(500);
    expect(parsed.state.volume.avgImageGB).toBeCloseTo(0.4, 5);
  });

  it("EDGE: an interspersed comment line does not break a hand-authored file", () => {
    const csv = [
      "key,value",
      `format,${INPUTS_CSV_FORMAT}`,
      `formatVersion,${INPUTS_CSV_FORMAT_VERSION}`,
      "# a stray comment in the middle",
      "provider,aws",
      "region,us-east-1",
      "capability.auditLogs,true",
      "volume.accountCount,10",
      "volume.ingressGBPerDay,5",
      "volume.peakMBps,1",
      "volume.peakEventsPerSec,500",
      "volume.overrideStreamMetrics,false",
      "assumption.monthHours,730",
      "assumption.assumedEventBytes,1024",
      "assumption.avgStoredGB,50",
      "assumption.logIntensity,low",
    ].join("\n");
    const parsed = parseEstimatorInputsCsv(csv);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("; ")).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.provider).toBe("aws");
  });

  it("EDGE: a bad value in an otherwise-good template still fails closed", () => {
    const broken = customerPlanTemplateCsv().replace(
      "volume.accountCount,25",
      "volume.accountCount,-5",
    );
    const parsed = parseEstimatorInputsCsv(broken);
    expect(parsed.ok).toBe(false);
  });

  it("the panel offers both CSV and Excel template downloads", () => {
    const getState = (): EstimatorInputsState => sample;
    render(<InputsCsvPanel getState={getState} onImport={vi.fn()} />);
    expect(screen.getByTestId("download-plan-template")).toBeInTheDocument();
    expect(screen.getByTestId("download-xlsx-template")).toBeInTheDocument();
    // The import input accepts .xlsx as well as .csv.
    const input = screen.getByTestId("import-inputs-csv") as HTMLInputElement;
    expect(input.getAttribute("accept")).toMatch(/\.xlsx/);
  });
});
