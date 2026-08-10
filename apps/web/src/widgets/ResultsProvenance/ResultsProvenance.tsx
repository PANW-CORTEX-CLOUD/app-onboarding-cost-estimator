/**
 * Results provenance: inputHash + resolvedVolume chip (package 07/08).
 */
export type ResolvedVolumeChip = {
  ingressGBPerDay?: number;
  peakMBps?: number;
  peakEventsPerSec?: number;
  overrideStreamMetrics?: boolean;
};

export type ResultsProvenanceProps = {
  inputHash?: string | null;
  modelVersion?: string | null;
  resolvedVolume?: ResolvedVolumeChip | null;
  loading?: boolean;
};

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function ResultsProvenance({
  inputHash = null,
  modelVersion = null,
  resolvedVolume = null,
  loading = false,
}: ResultsProvenanceProps) {
  const hasHash = Boolean(inputHash?.trim());
  const hasResolved =
    resolvedVolume != null &&
    (resolvedVolume.ingressGBPerDay != null ||
      resolvedVolume.peakMBps != null ||
      resolvedVolume.peakEventsPerSec != null);

  if (!hasHash && !modelVersion && !hasResolved && !loading) {
    return (
      <p data-testid="results-summary-detail" className="results-meta-line">
        Model version: —
      </p>
    );
  }

  return (
    <div data-testid="results-provenance" className="results-provenance">
      <p data-testid="results-summary-detail" className="results-meta-line">
        Model version: {modelVersion ?? "—"}
        {loading ? " · Updating…" : null}
        {hasHash ? (
          <>
            {" · "}
            <span data-testid="results-input-hash" title={inputHash!}>
              inputHash {truncateHash(inputHash!)}
            </span>
            <button
              type="button"
              className="linkish"
              data-testid="copy-input-hash"
              onClick={() => {
                void navigator.clipboard?.writeText(inputHash!);
              }}
            >
              Copy
            </button>
          </>
        ) : null}
      </p>
      {hasResolved ? (
        <p
          data-testid="resolved-volume-chip"
          className="resolved-volume-chip field-hint"
        >
          Resolved volume: ingress {resolvedVolume!.ingressGBPerDay ?? "—"}{" "}
          GB/day · peak {resolvedVolume!.peakMBps ?? "—"} MB/s · peak EPS{" "}
          {resolvedVolume!.peakEventsPerSec ?? "—"}
          {resolvedVolume!.overrideStreamMetrics != null
            ? ` · override ${resolvedVolume!.overrideStreamMetrics ? "on" : "off"}`
            : null}
        </p>
      ) : null}
    </div>
  );
}
