/**
 * Native Excel (`.xlsx`) support for the customer plan file.
 *
 * A customer often keeps the estate numbers in a real Excel workbook, not a CSV.
 * This reads an uploaded `.xlsx` and generates a downloadable `.xlsx` template,
 * so "fill it in Excel and upload" works with the actual Excel binary format —
 * no CSV round-trip required.
 *
 * Two deliberate choices:
 *
 * - **ExcelJS**, not SheetJS. The free npm `xlsx` (SheetJS Community) is pinned
 *   at 0.18.5 with two unpatched high-severity advisories — prototype pollution
 *   (CVE-2023-30533) and ReDoS (CVE-2024-22363) — the fixes living only behind a
 *   paid CDN. Parsing an untrusted customer upload with that is the wrong trade.
 *   ExcelJS is MIT with no equivalent open advisory.
 * - **Lazy-loaded** via dynamic `import("exceljs")`, so the (large) Excel codec
 *   is only fetched when a customer actually uses the Excel path; it never bloats
 *   the main bundle for everyone else.
 *
 * The strict validation is **not** re-implemented here: a workbook is turned into
 * the same `Map<string,string>` a CSV produces and handed to
 * {@link validateEstimatorInputsMap}, so `.csv` and `.xlsx` uploads are held to
 * exactly the same rules.
 */
import {
  customerPlanTemplateCsv,
  validateEstimatorInputsMap,
  type EstimatorInputsParseResult,
} from "./estimatorInputsCsv.ts";

/** An uploaded workbook larger than this is refused (a zip can expand a lot). */
export const INPUTS_XLSX_MAX_BYTES = 5 * 1024 * 1024;

/** MIME type for a generated `.xlsx` download. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Load ExcelJS lazily so the codec is out of the main bundle. */
async function loadExcelJs(): Promise<typeof import("exceljs")> {
  const mod = (await import("exceljs")) as unknown as {
    default?: typeof import("exceljs");
  } & typeof import("exceljs");
  return mod.default ?? mod;
}

/** Coerce an ExcelJS cell value to the plain string the validator expects. */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Formula cells surface as { result } / { formula }; rich text as { richText }.
  const obj = value as {
    result?: unknown;
    text?: unknown;
    richText?: Array<{ text?: string }>;
  };
  if (obj.result != null) return cellToString(obj.result);
  if (typeof obj.text === "string") return obj.text;
  if (Array.isArray(obj.richText)) {
    return obj.richText.map((r) => r.text ?? "").join("");
  }
  return String(value);
}

/**
 * Parse an uploaded `.xlsx` into estimator inputs state.
 *
 * Reads the first worksheet as a two-column `key | value` sheet: comment rows
 * (col A starts with `#`), blank rows, and the literal `key,value` header are
 * skipped; every other row contributes `key → value` to a map that is then run
 * through the shared validator. Fails closed on an oversized file, a corrupt
 * workbook, or a sheet that is not a plan file (wrong/missing `format`).
 *
 * @param buffer the uploaded file's bytes (`File.arrayBuffer()`)
 */
export async function parseEstimatorInputsXlsx(
  buffer: ArrayBuffer,
): Promise<EstimatorInputsParseResult> {
  if (buffer.byteLength > INPUTS_XLSX_MAX_BYTES) {
    return {
      ok: false,
      errors: [
        `File exceeds ${INPUTS_XLSX_MAX_BYTES} byte cap (${buffer.byteLength} bytes)`,
      ],
    };
  }

  let ExcelJS: typeof import("exceljs");
  try {
    ExcelJS = await loadExcelJs();
  } catch {
    return { ok: false, errors: ["Could not load the Excel reader"] };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return { ok: false, errors: ["Not a readable .xlsx workbook"] };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false, errors: ["Workbook has no sheets"] };

  const map = new Map<string, string>();
  const errors: string[] = [];
  let sawHeader = false;
  sheet.eachRow((row) => {
    const key = cellToString(row.getCell(1).value).trim();
    if (!key || key.startsWith("#")) return; // comment / blank row
    const value = cellToString(row.getCell(2).value).trim();
    if (key.toLowerCase() === "key" && value.toLowerCase() === "value") {
      sawHeader = true;
      return; // header row
    }
    if (map.has(key)) {
      errors.push(`Duplicate key: ${key}`);
      return;
    }
    map.set(key, value);
  });

  if (!sawHeader && !map.has("format")) {
    return {
      ok: false,
      errors: [
        'Not a plan file — expected a "key" / "value" sheet. Download the Excel template and fill it in.',
      ],
    };
  }
  if (errors.length) return { ok: false, errors };

  return validateEstimatorInputsMap(map);
}

/**
 * Build a downloadable `.xlsx` customer plan template.
 *
 * The content is generated from {@link customerPlanTemplateCsv} — one source of
 * truth for the example values and instructions — laid out as a two-column
 * sheet: `#` lines become single-cell comment rows, `key,value` lines become
 * `key | value` rows. Re-uploading the unedited file round-trips.
 *
 * @returns the workbook bytes, ready to wrap in a Blob for download
 */
export async function buildCustomerPlanWorkbook(): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Cortex Cloud cost estimator";
  const sheet = workbook.addWorksheet("Cortex Cost Plan");
  sheet.columns = [
    { header: "key", key: "key", width: 34 },
    { header: "value", key: "value", width: 46 },
  ];
  // Replace the auto-added header row: we emit our own from the CSV template so
  // the file is identical in shape to the .csv one.
  sheet.spliceRows(1, 1);

  for (const line of customerPlanTemplateCsv().split("\n")) {
    if (line.trim().length === 0) continue;
    if (line.startsWith("#")) {
      const r = sheet.addRow([line]);
      r.font = { italic: true, color: { argb: "FF6B7280" } };
      continue;
    }
    const comma = line.indexOf(",");
    const key = comma === -1 ? line : line.slice(0, comma);
    const value = comma === -1 ? "" : line.slice(comma + 1);
    const r = sheet.addRow([key, value]);
    if (key === "key") r.font = { bold: true };
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
