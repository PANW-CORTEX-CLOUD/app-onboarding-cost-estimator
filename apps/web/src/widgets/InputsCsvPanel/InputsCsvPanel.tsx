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
import { downloadBlob } from "../../features/export-estimate/buildExport.ts";

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

  function onFile(file: File | null) {
    setErrors([]);
    setStatus(null);
    if (!file) return;
    if (file.size > 256 * 1024) {
      setErrors([`File exceeds 256KiB cap (${file.size} bytes)`]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseEstimatorInputsCsv(text, file.size);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        return;
      }
      onImport(parsed.state, parsed.keyCount);
      setStatus(`Imported ${parsed.keyCount} keys · re-estimating…`);
      if (fileRef.current) fileRef.current.value = "";
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
          data-testid="download-plan-template"
          onClick={onDownloadTemplate}
        >
          Download plan template
        </button>
        <button
          type="button"
          data-testid="download-inputs-csv"
          onClick={onDownload}
        >
          Download inputs CSV
        </button>
        <label className="inputs-csv-import-label">
          Import inputs CSV
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
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
