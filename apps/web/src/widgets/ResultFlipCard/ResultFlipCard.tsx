/**
 * Cost results flip card — high-level drivers (front) vs meter breakdown (back).
 * Session-persisted face; reduced-motion uses instant swap (no 3D rotate).
 */
import { useEffect, useState, type ReactNode } from "react";

export type ResultFlipFace = "high" | "low";

export const RESULT_COST_FACE_SESSION_KEY = "cc-results-cost-face";

export function readCostFaceFromSession(
  getItem: (k: string) => string | null = (k) =>
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem(k) : null,
): ResultFlipFace {
  const raw = getItem(RESULT_COST_FACE_SESSION_KEY);
  if (raw === "low" || raw === "high") return raw;
  return "high";
}

export function writeCostFaceToSession(
  face: ResultFlipFace,
  setItem: (k: string, v: string) => void = (k, v) => {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(k, v);
  },
): void {
  setItem(RESULT_COST_FACE_SESSION_KEY, face);
}

export type ResultFlipCardProps = {
  high: ReactNode;
  low: ReactNode;
  /** Controlled face; when omitted, uses session default. */
  face?: ResultFlipFace;
  onFaceChange?: (face: ResultFlipFace) => void;
};

export function ResultFlipCard({
  high,
  low,
  face: faceProp,
  onFaceChange,
}: ResultFlipCardProps) {
  const [internal, setInternal] = useState<ResultFlipFace>(() =>
    readCostFaceFromSession(),
  );
  const face = faceProp ?? internal;

  useEffect(() => {
    writeCostFaceToSession(face);
  }, [face]);

  function setFace(next: ResultFlipFace) {
    if (faceProp == null) setInternal(next);
    onFaceChange?.(next);
  }

  const showingLow = face === "low";

  return (
    <div
      data-testid="result-flip-card"
      className={`result-flip-card${showingLow ? " result-flip-card--flipped" : ""}`}
      data-face={face}
    >
      <div className="result-flip-toolbar">
        <button
          type="button"
          data-testid="result-flip-toggle"
          aria-pressed={showingLow}
          onClick={() => setFace(showingLow ? "high" : "low")}
        >
          {showingLow ? "Show drivers" : "Show meter line items"}
        </button>
        <span className="field-hint" data-testid="result-flip-face-label">
          {showingLow ? "Meter line items" : "Cost drivers"}
        </span>
      </div>
      <div className="result-flip-scene">
        <div className="result-flip-inner">
          <div
            className="result-flip-face result-flip-face--high"
            data-testid="result-flip-face-high"
            aria-hidden={showingLow}
          >
            {!showingLow ? high : null}
          </div>
          <div
            className="result-flip-face result-flip-face--low"
            data-testid="result-flip-face-low"
            aria-hidden={!showingLow}
          >
            {showingLow ? low : null}
          </div>
        </div>
      </div>
    </div>
  );
}
