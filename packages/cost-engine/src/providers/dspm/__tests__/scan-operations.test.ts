/**
 * REQ-1 — scanning is billed per operation, never per gigabyte.
 *
 * The old model multiplied gigabytes by a per-10k-operations price, which is
 * not a currency amount. These tests pin the replacement to the vendors' own
 * documented behaviour: one read operation per object regardless of object
 * size, plus paginated list operations to enumerate the estate.
 */
import { describe, expect, it } from "vitest";
import {
  opsCost,
  scanOperationCounts,
} from "../scan-operations.ts";
import { estimateAzureDspm } from "../../azure/azure-dspm-estimator.ts";
import { estimateAwsDspm } from "../../aws/aws-dspm-estimator.ts";
import { estimateGcpDspm } from "../../gcp/gcp-dspm-estimator.ts";
import { captureLogs } from "../../../core/debug-log.ts";
import type { RateCard } from "../../../core/models/estimate.types.ts";

const azureRates: RateCard = {
  provider: "azure",
  region: "eastus",
  currency: "USD",
  unitPrices: {
    "blob-hot-lrs-read-10k": 0.004,
    "blob-hot-lrs-list-10k": 0.05,
    "vm-outpost-scanner": 0.096,
  },
  capturedAt: "2026-08-10T00:00:00.000Z",
};

const baseInputs = {
  enabled: true,
  region: "eastus",
  dataEstateGB: 1024,
  pctScanned: 100,
  scansPerMonth: 1,
  discoveryTelemetryEmpty: false,
};

describe("T-1.1.1 — gigabytes become an object count", () => {
  it("converts GB to objects at the stated average object size", () => {
    // 1024 GB at 4 MB per object = 1024 * 1024 / 4 = 262,144 objects.
    const ops = scanOperationCounts("azure", 1024, 4);
    expect(ops.objects).toBe(262_144);
    expect(ops.readOps).toBe(262_144);
  });

  it("one read operation per object, whatever the object size", () => {
    // Microsoft: downloading a blob from the Blob Service endpoint costs a
    // single read operation regardless of the blob's size.
    const small = scanOperationCounts("azure", 100, 1);
    const large = scanOperationCounts("azure", 100, 100);
    expect(small.readOps).toBe(100 * 1024);
    expect(large.readOps).toBe(100 * 1024 / 100);
    expect(large.readOps).toBeLessThan(small.readOps);
  });

  it("EDGE: a non-positive object size throws instead of yielding Infinity", () => {
    expect(() => scanOperationCounts("azure", 100, 0)).toThrow(/must be > 0/);
    expect(() => scanOperationCounts("azure", 100, -4)).toThrow(/must be > 0/);
    expect(() => scanOperationCounts("azure", 100, Number.NaN)).toThrow(/must be > 0/);
  });

  it("EDGE: an empty estate yields zero operations, not NaN", () => {
    const ops = scanOperationCounts("azure", 0, 4);
    expect(ops.objects).toBe(0);
    expect(ops.readOps).toBe(0);
    expect(ops.listOps).toBe(0);
  });

  it("EDGE: a negative estate is rejected", () => {
    expect(() => scanOperationCounts("azure", -1, 4)).toThrow(/non-negative/);
  });
});

describe("T-1.1.2 — enumeration is paginated and billed separately", () => {
  it("uses each provider's documented maximum page size", () => {
    expect(scanOperationCounts("azure", 1, 1).listPageSize).toBe(5_000);
    expect(scanOperationCounts("aws", 1, 1).listPageSize).toBe(1_000);
    expect(scanOperationCounts("gcp", 1, 1).listPageSize).toBe(1_000);
  });

  it("EDGE: fewer objects than one page still costs one list operation", () => {
    const ops = scanOperationCounts("azure", 1, 1024); // exactly 1 object
    expect(ops.objects).toBe(1);
    expect(ops.listOps).toBe(1);
  });

  it("EDGE: exactly one full page does not spill into a second", () => {
    // 5000 objects at 1 MB each = 5000 MB = 4.8828125 GB
    const ops = scanOperationCounts("azure", 5000 / 1024, 1);
    expect(ops.objects).toBeCloseTo(5000, 6);
    expect(ops.listOps).toBe(1);
  });

  it("one object past a page boundary costs a second list operation", () => {
    const ops = scanOperationCounts("azure", 5001 / 1024, 1);
    expect(ops.listOps).toBe(2);
  });

  it("operations are priced per 10,000", () => {
    expect(opsCost(10_000, 0.004)).toBeCloseTo(0.004, 12);
    expect(opsCost(262_144, 0.004)).toBeCloseTo(0.1048576, 12);
    expect(opsCost(0, 0.05)).toBe(0);
  });
});

describe("T-1.1.2 — the DSPM estimate reproduces the arithmetic end to end", () => {
  it("bills read and list operations as separate, checkable lines", () => {
    const res = estimateAzureDspm(
      { ...baseInputs, avgObjectSizeMB: 4 },
      azureRates,
    );

    const objects = 262_144;
    const expectedRead = (objects / 10_000) * 0.004;
    const expectedList = (Math.ceil(objects / 5_000) / 10_000) * 0.05;

    const read = res.lineItems.find((l) => l.meterId === "blob-hot-lrs-read-10k");
    const list = res.lineItems.find((l) => l.meterId === "blob-hot-lrs-list-10k");
    expect(read?.amount).toBeCloseTo(expectedRead, 12);
    expect(list?.amount).toBeCloseTo(expectedList, 12);
    expect(res.totals.expected).toBeCloseTo(expectedRead + expectedList, 12);
  });

  it("no DSPM line uses a per-GB meter the vendor does not publish", () => {
    const retired = ["s3-data-retrieval-band", "gcs-data-read-band", "blob-data-read-ops"];
    const awsRates: RateCard = {
      provider: "aws",
      region: "us-east-1",
      currency: "USD",
      unitPrices: { "s3-get-10k": 0.004, "s3-put-10k": 0.05, "ec2-outpost-scanner": 0.0416 },
      capturedAt: "2026-08-10T00:00:00.000Z",
    };
    const gcpRates: RateCard = {
      provider: "gcp",
      region: "us-central1",
      currency: "USD",
      unitPrices: { "gcs-class-b-10k": 0.004, "gcs-class-a-10k": 0.05, "gce-outpost-scanner": 0.0475 },
      capturedAt: "2026-08-10T00:00:00.000Z",
    };
    const results = [
      estimateAzureDspm({ ...baseInputs }, azureRates),
      estimateAwsDspm({ ...baseInputs, region: "us-east-1" }, awsRates),
      estimateGcpDspm({ ...baseInputs, region: "us-central1" }, gcpRates),
    ];
    for (const res of results) {
      for (const line of res.lineItems) {
        expect(retired).not.toContain(line.meterId);
      }
    }
  });

  it("halving the average object size doubles the read cost", () => {
    const coarse = estimateAzureDspm({ ...baseInputs, avgObjectSizeMB: 8 }, azureRates);
    const fine = estimateAzureDspm({ ...baseInputs, avgObjectSizeMB: 4 }, azureRates);

    const readOf = (r: typeof coarse) =>
      r.lineItems.find((l) => l.meterId === "blob-hot-lrs-read-10k")?.amount ?? 0;

    // Reads are exactly per-object, so they scale exactly.
    expect(readOf(fine)).toBeCloseTo(readOf(coarse) * 2, 12);
    // List operations are per *page* and round up, so the total tracks the
    // doubling closely but is not obliged to hit it exactly.
    expect(fine.totals.expected).toBeGreaterThan(coarse.totals.expected * 1.9);
    expect(fine.totals.expected).toBeLessThanOrEqual(coarse.totals.expected * 2.1);
  });

  it("EDGE: an invalid object size fails the estimate rather than the total", () => {
    expect(() =>
      estimateAzureDspm({ ...baseInputs, avgObjectSizeMB: 0 }, azureRates),
    ).toThrow(/avgObjectSizeMB must be > 0/);
  });

  it("EDGE: a missing list rate fails closed, it does not silently skip listing", () => {
    const withoutList: RateCard = {
      ...azureRates,
      unitPrices: { "blob-hot-lrs-read-10k": 0.004 },
    };
    expect(() => estimateAzureDspm({ ...baseInputs }, withoutList)).toThrow(
      /missing unit price for meter 'blob-hot-lrs-list-10k'/,
    );
  });
});

describe("T-1.2.1 — the assumption and the counts are stated, not hidden", () => {
  it("notes carry the object count, both operation counts and the page size", () => {
    const res = estimateAzureDspm({ ...baseInputs, avgObjectSizeMB: 4 }, azureRates);
    const notes = res.notes.join(" ");
    expect(notes).toMatch(/262,144 objects/);
    expect(notes).toMatch(/4 MB average object size/);
    expect(notes).toMatch(/read operations/);
    expect(notes).toMatch(/list operations/);
    expect(notes).toMatch(/5000 objects per page/);
  });

  it("says plainly that object stores bill per operation", () => {
    const res = estimateAzureDspm({ ...baseInputs }, azureRates);
    expect(res.notes.join(" ")).toMatch(/bill per operation, not per GB/i);
  });
});

describe("T-7.1.1 — the arithmetic is debuggable without a debugger", () => {
  it("is silent unless its namespace is switched on", () => {
    const { records } = captureLogs("cost:rates", () =>
      estimateAzureDspm({ ...baseInputs }, azureRates),
    );
    expect(records).toStrictEqual([]);
  });

  it("explains the conversion when cost:dspm is enabled", () => {
    const { records } = captureLogs("cost:*", () =>
      estimateAzureDspm({ ...baseInputs, avgObjectSizeMB: 4 }, azureRates),
    );
    expect(records.length).toBeGreaterThan(0);
    const line = records.map((r) => r.message).join(" ");
    expect(line).toMatch(/objects=262144/);
    expect(line).toMatch(/readOps=262144/);
    expect(line).toMatch(/listOps=53/);
    expect(records[0]?.namespace).toBe("cost:dspm");
  });
});
