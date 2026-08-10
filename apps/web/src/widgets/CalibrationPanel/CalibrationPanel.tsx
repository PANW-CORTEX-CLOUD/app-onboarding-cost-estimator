/**
 * Calibration UI — local CSV import + apply volume factor (package 23).
 */
import { useState } from "react";
import {
  LIST_VS_ACTUAL_NOTE,
  parseBillingCsv,
  scaleVolumeFields,
  suggestCalibrationFactor,
  type CalibrationParseResult,
} from "../../features/calibration/billingCsv.ts";

export type CalibrationPanelProps = {
  estimatedExpected: number | null;
  volume: Record<string, number>;
  onApplyVolume: (next: Record<string, number>, factor: number) => void;
};

export function CalibrationPanel({
  estimatedExpected,
  volume,
  onApplyVolume,
}: CalibrationPanelProps) {
  const [result, setResult] = useState<CalibrationParseResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [factor, setFactor] = useState<number | null>(null);

  function onFile(file: File | null) {
    setErrors([]);
    setResult(null);
    setFactor(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseBillingCsv(text);
      if ("ok" in parsed && parsed.ok === false) {
        setErrors(parsed.errors);
        return;
      }
      const ok = parsed as CalibrationParseResult;
      setResult(ok);
      if (estimatedExpected != null) {
        setFactor(suggestCalibrationFactor(estimatedExpected, ok.totalActual));
      }
    };
    reader.onerror = () => setErrors(["Failed to read file"]);
    reader.readAsText(file);
  }

  function apply() {
    if (factor == null) return;
    try {
      const next = scaleVolumeFields(volume, factor);
      onApplyVolume(next, factor);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Apply failed"]);
    }
  }

  return (
    <div data-testid="calibration-panel">
      <p data-testid="calibration-list-note" className="muted">
        {LIST_VS_ACTUAL_NOTE}
      </p>
      <label>
        Import billing CSV (Azure / AWS / GCP — local only){" "}
        <input
          type="file"
          accept=".csv,text/csv"
          data-testid="calibration-file"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {errors.length > 0 ? (
        <ul role="alert" data-testid="calibration-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {result ? (
        <div data-testid="calibration-result">
          <p>
            Provider: {result.provider} · Actual total:{" "}
            {result.totalActual.toFixed(2)} {result.currency}
          </p>
          <p data-testid="calibration-unmatched">
            Unmatched rows: {result.unmatched.length}
          </p>
          {result.unmatched.length > 0 ? (
            <ul data-testid="calibration-unmatched-list">
              {result.unmatched.slice(0, 10).map((r, i) => (
                <li key={`${r.service}-${i}`}>
                  {r.service || "(blank)"} — {r.amount}
                </li>
              ))}
            </ul>
          ) : null}
          {factor != null ? (
            <p data-testid="calibration-factor">
              Suggested volume factor: {factor.toFixed(3)}×
            </p>
          ) : null}
          <button
            type="button"
            data-testid="calibration-apply"
            disabled={factor == null}
            onClick={apply}
          >
            Apply factor to volume (local)
          </button>
        </div>
      ) : null}
    </div>
  );
}
