/**
 * REQ-22 — native Excel (.xlsx) plan file, held to the same validation as CSV.
 *
 * Uses the real ExcelJS codec (no mock): generate the template workbook, read it
 * back, and confirm it round-trips to a valid state — proving the whole
 * upload→parse chain on genuine .xlsx bytes.
 */
import { describe, expect, it } from "vitest";
import {
  buildCustomerPlanWorkbook,
  parseEstimatorInputsXlsx,
} from "./estimatorInputsXlsx.ts";

describe("REQ-22 — .xlsx plan file", () => {
  it("the generated Excel template round-trips to a valid state", async () => {
    const buffer = await buildCustomerPlanWorkbook();
    expect(buffer.byteLength).toBeGreaterThan(0);
    const parsed = await parseEstimatorInputsXlsx(buffer);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("; ")).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.provider).toBe("azure");
    expect(parsed.state.capabilities.auditLogs).toBe(true);
    expect(parsed.state.capabilities.dspm).toBe(true);
    expect(parsed.state.volume.dataEstateGB).toBeGreaterThan(0);
  });

  it("reflects a customer edit made in the workbook", async () => {
    // Build the template, edit a cell in-workbook (as a customer would in Excel),
    // write it back out, and re-parse.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildCustomerPlanWorkbook());
    const sheet = wb.worksheets[0]!;
    sheet.eachRow((row) => {
      if (String(row.getCell(1).value) === "volume.accountCount") {
        row.getCell(2).value = 250;
      }
      if (String(row.getCell(1).value) === "capability.dspm") {
        row.getCell(2).value = "false";
      }
    });
    const edited = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const parsed = await parseEstimatorInputsXlsx(edited);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.join("; ")).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.state.volume.accountCount).toBe(250);
    expect(parsed.state.capabilities.dspm).toBe(false);
  });

  it("EDGE: a non-plan workbook fails closed with a clear message", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const s = wb.addWorksheet("Sheet1");
    s.addRow(["Service", "Cost"]);
    s.addRow(["Event Hubs", 12.5]);
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const parsed = await parseEstimatorInputsXlsx(buffer);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toMatch(/plan file|format/i);
  });

  it("EDGE: an oversized file is refused before parsing", async () => {
    const big = new ArrayBuffer(5 * 1024 * 1024 + 1);
    const parsed = await parseEstimatorInputsXlsx(big);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join(" ")).toMatch(/cap|exceeds/i);
  });

  it("EDGE: garbage bytes are rejected as an unreadable workbook, not a crash", async () => {
    const notXlsx = new TextEncoder().encode("this is not a workbook").buffer;
    const parsed = await parseEstimatorInputsXlsx(notXlsx);
    expect(parsed.ok).toBe(false);
  });
});
