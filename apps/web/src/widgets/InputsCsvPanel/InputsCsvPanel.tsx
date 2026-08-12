/**
 * Inputs CSV panel — download/import estimator inputs for external edit (01/01).
 * No pricing math; applies parsed state via parent callback.
 */
import { useRef, useState } from "react";
import {
  customerPlanTemplateCsv,
  exportEstimatorInputsCsv,
  parseEstimatorInputsCsv,
  type EstimatorInputsState,
} from "../../features/estimator-inputs-csv/estimatorInputsCsv.ts";
import {
  XLSX_MIME,
  buildCustomerPlanWorkbook,
  parseEstimatorInputsXlsx,
} from "../../features/estimator-inputs-csv/estimatorInputsXlsx.ts";
import { downloadBlob } from "../../features/export-estimate/buildExport.ts";

/** True when the picked file is an Excel workbook (by name or MIME). */
function isXlsx(file: File): boolean {
  return /\.xlsx$/i.test(file.name) || file.type === XLSX_MIME;
}

export type InputsCsvPanelProps = {
  /** Current UI inputs snapshot for download. */
  getState: () => EstimatorInputsState;
  /** Apply imported state (parent sets fields + triggers re-estimate). */
  onImport: (state: EstimatorInputsState, keyCount: number) => void;
};

export function InputsCsvPanel({ getState, onImport }: InputsCsvPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  function onDownload() {
    setErrors([]);
    setStatus(null);
    const csv = exportEstimatorInputsCsv(getState());
    downloadBlob(
      `estimator-inputs-${getState().provider}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    setStatus("Downloaded inputs CSV");
  }

  /**
   * Download a blank, self-documenting customer plan file. Unlike the export
   * above it does not snapshot current state — a customer starting from nothing
   * gets a complete, valid, example-filled template to edit in Excel and upload.
   */
  function onDownloadTemplate() {
    setErrors([]);
    setStatus(null);
    downloadBlob(
      "cortex-cost-plan-template.csv",
      new Blob([customerPlanTemplateCsv()], { type: "text/csv;charset=utf-8" }),
    );
    setStatus("Downloaded plan template — fill it in Excel, then Import");
  }

  /** Download the plan template as a native Excel workbook. */
  async function onDownloadXlsxTemplate() {
    setErrors([]);
    setStatus(null);
    try {
      const buffer = await buildCustomerPlanWorkbook();
      downloadBlob(
        "cortex-cost-plan-template.xlsx",
        new Blob([buffer], { type: XLSX_MIME }),
      );
      setStatus("Downloaded Excel template — fill it in, then Import");
    } catch {
      setErrors(["Could not generate the Excel template"]);
    }
  }

  function applyParsed(
    parsed: { ok: true; state: EstimatorInputsState; keyCount: number } | { ok: false; errors: string[] },
  ) {
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    onImport(parsed.state, parsed.keyCount);
    setStatus(`Imported ${parsed.keyCount} keys · re-estimating…`);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onFile(file: File | null) {
    setErrors([]);
    setStatus(null);
    if (!file) return;

    // Excel workbook → read bytes and parse via the lazy-loaded xlsx reader; the
    // strict validation is shared with the CSV path.
    if (isXlsx(file)) {
      void file
        .arrayBuffer()
        .then(parseEstimatorInputsXlsx)
        .then(applyParsed)
        .catch(() => setErrors(["Failed to read Excel file"]));
      return;
    }

    if (file.size > 256 * 1024) {
      setErrors([`File exceeds 256KiB cap (${file.size} bytes)`]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      applyParsed(parseEstimatorInputsCsv(text, file.size));
    };
    reader.onerror = () => setErrors(["Failed to read file"]);
    reader.readAsText(file);
  }

  return (
    <div data-testid="inputs-csv-panel" className="inputs-csv-panel">
      <p className="field-hint">
        Spreadsheet edit of inputs (not results line-item $). Fill the template in
        Excel and import it to get a cost, or export your current inputs to edit.
        Re-import refreshes the estimate.
      </p>
      <p className="export-actions">
        <button
          type="button"
          data-testid="download-xlsx-template"
          onClick={() => void onDownloadXlsxTemplate()}
        >
          Download Excel template
        </button>
        <button
          type="button"
          data-testid="download-plan-template"
          onClick={onDownloadTemplate}
        >
          Download CSV template
        </button>
        <button
          type="button"
          data-testid="download-inputs-csv"
          onClick={onDownload}
        >
          Download inputs CSV
        </button>
        <label className="inputs-csv-import-label">
          Import plan file (.xlsx or .csv)
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            data-testid="import-inputs-csv"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </p>
      {errors.length > 0 ? (
        <ul role="alert" data-testid="inputs-csv-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {status ? (
        <p role="status" data-testid="inputs-csv-status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
