/**
 * Projection charts — stacked monthly run-rate, cumulative TCO, volume overlay.
 * Consumes createProjection series only (no pricing math in the widget).
 */
import { useMemo, useState } from "react";
import type { components } from "../../shared/api/generated/openapi.types.ts";
import { colorForCapability } from "../../shared/model/chart-colors.ts";
import { capabilityLabel } from "../../shared/model/capability-labels.ts";
import { ProjectionTable } from "../ProjectionTable/ProjectionTable.tsx";
import { RatesFreshnessBanner } from "../RatesFreshnessBanner/RatesFreshnessBanner.tsx";
import { formatUsd } from "../../shared/lib/format-currency.ts";
import { PROJECTION_MAX_MONTHS } from "../../shared/model/projection-limits.ts";

type ProjectionResponse = components["schemas"]["ProjectionResponse"];
type FreshnessLevel = "fresh" | "warn" | "critical" | "stale-cache";

export type ProjectionChartsProps = {
  projection: ProjectionResponse | null;
  loading?: boolean;
  error?: string | null;
  months: number;
  growthPercent: number;
  onMonthsChange: (n: number) => void;
  onGrowthChange: (n: number) => void;
  staleBanner?: { level: FreshnessLevel; message: string } | null;
  /** Enabled capabilities — legend includes all even when stacks are $0 (package 26). */
  enabledCapabilities?: string[];
};

type HoverInfo = {
  month: number;
  provider: string;
  meterId: string;
  capability: string;
  amount: number;
  confidence: string;
} | null;

/** Whole-dollar precision for compact chart axis/legend labels. */
function usd(n: number): string {
  return formatUsd(n, 0);
}

export function ProjectionCharts({
  projection,
  loading = false,
  error = null,
  months,
  growthPercent,
  onMonthsChange,
  onGrowthChange,
  staleBanner = null,
  enabledCapabilities,
}: ProjectionChartsProps) {
  const [hover, setHover] = useState<HoverInfo>(null);
  const series = projection?.series ?? null;
  const provider = projection?.provider;

  const capabilities = useMemo(() => {
    const set = new Set<string>();
    if (enabledCapabilities?.length) {
      for (const c of enabledCapabilities) set.add(c);
    }
    for (const p of series ?? []) {
      for (const s of p.stacks ?? []) set.add(s.capability);
    }
    return [...set];
  }, [series, enabledCapabilities]);

  const maxExpected = Math.max(
    1,
    ...(series ?? []).map((p) => p.high ?? p.expected),
  );
  const maxCumulative = Math.max(
    1,
    ...(series ?? []).map((p) => p.cumulative),
  );

  const W = 560;
  const H = 180;
  const pad = 28;

  return (
    <div data-testid="projections-layout">
      {staleBanner ? (
        <RatesFreshnessBanner
          level={staleBanner.level}
          message={staleBanner.message}
          testId="projection-stale-banner"
        />
      ) : null}

      <div className="projection-controls">
        <label>
          Horizon (months){" "}
          <input
            type="number"
            min={1}
            max={PROJECTION_MAX_MONTHS}
            value={months}
            data-testid="projection-months"
            onChange={(e) =>
              onMonthsChange(
                Math.min(
                  PROJECTION_MAX_MONTHS,
                  Math.max(1, Number(e.target.value) || 1),
                ),
              )
            }
          />
        </label>
        <label>
          Annual volume growth %{" "}
          <input
            type="number"
            value={growthPercent}
            data-testid="projection-growth"
            onChange={(e) => onGrowthChange(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      {loading ? <p role="status">Loading projection…</p> : null}
      {error ? (
        <p role="alert" data-testid="projection-error">
          {error}
        </p>
      ) : null}

      {projection?.disclaimer ? (
        <p data-testid="projection-disclaimer" className="muted">
          {projection.disclaimer}
        </p>
      ) : null}

      {capabilities.length > 0 ? (
        <ul data-testid="projection-legend" aria-label="Capability color legend">
          {capabilities.map((c) => (
            <li key={c}>
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  background: colorForCapability(c),
                  marginRight: 6,
                }}
              />
              {capabilityLabel(c)}
            </li>
          ))}
        </ul>
      ) : null}

      {hover ? (
        <p data-testid="projection-hover" role="status">
          Period {hover.month} · {hover.provider} · {hover.capability}/
          {hover.meterId} · {usd(hover.amount)} · {hover.confidence}
        </p>
      ) : (
        <p data-testid="projection-hover-hint" className="muted">
          Hover a stack segment for period, provider, meter, amount, confidence.
        </p>
      )}

      <div
        data-testid="projection-charts"
        aria-label="Projection charts"
      >
        <h3>Stacked monthly run-rate</h3>
        {series ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label="Stacked monthly run-rate chart"
            data-testid="chart-stacked"
          >
            {series.map((p, i) => {
              const bw = (W - pad * 2) / series.length;
              const x = pad + i * bw + 2;
              let y = H - pad;
              const stacks =
                p.stacks && p.stacks.length > 0
                  ? p.stacks
                  : [
                      {
                        provider: provider ?? "—",
                        capability: "total",
                        meterId: "total",
                        amount: p.expected,
                        confidence: "—",
                      },
                    ];
              // low-confidence hatched envelope (EDGE)
              const envelope =
                p.low != null && p.high != null
                  ? ((p.high - p.low) / maxExpected) * (H - pad * 2)
                  : 0;
              const envelopeY =
                p.high != null
                  ? H - pad - (p.high / maxExpected) * (H - pad * 2)
                  : 0;
              return (
                <g key={p.month}>
                  {envelope > 0 ? (
                    <rect
                      x={x}
                      y={envelopeY}
                      width={Math.max(2, bw - 4)}
                      height={envelope}
                      fill="url(#hatch)"
                      data-testid={`envelope-${p.month}`}
                      opacity={0.45}
                    />
                  ) : null}
                  {stacks.map((s) => {
                    const h = (s.amount / maxExpected) * (H - pad * 2);
                    y -= h;
                    return (
                      <rect
                        key={`${p.month}-${s.meterId}`}
                        x={x}
                        y={y}
                        width={Math.max(2, bw - 4)}
                        height={Math.max(0.5, h)}
                        fill={colorForCapability(s.capability)}
                        data-testid={`stack-${p.month}-${s.meterId}`}
                        onMouseEnter={() =>
                          setHover({
                            month: p.month,
                            provider: s.provider,
                            meterId: s.meterId,
                            capability: s.capability,
                            amount: s.amount,
                            confidence: s.confidence,
                          })
                        }
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  })}
                </g>
              );
            })}
            <defs>
              <pattern
                id="hatch"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke="#9a031e"
                  strokeWidth="2"
                />
              </pattern>
            </defs>
          </svg>
        ) : (
          <p data-testid="projection-charts-empty">No chart data yet.</p>
        )}

        <h3>Cumulative TCO</h3>
        {series ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label="Cumulative TCO chart"
            data-testid="chart-cumulative"
          >
            <polyline
              fill="none"
              stroke="#1d4e89"
              strokeWidth="2"
              points={series
                .map((p, i) => {
                  const x =
                    pad +
                    (i / Math.max(1, series.length - 1)) * (W - pad * 2);
                  const y =
                    H - pad - (p.cumulative / maxCumulative) * (H - pad * 2);
                  return `${x},${y}`;
                })
                .join(" ")}
            />
          </svg>
        ) : null}

        <h3>Volume growth overlay</h3>
        {series ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            role="img"
            aria-label="Volume growth overlay"
            data-testid="chart-volume"
          >
            <polyline
              fill="none"
              stroke="#e36414"
              strokeWidth="2"
              strokeDasharray="4 3"
              points={series
                .map((p, i) => {
                  const maxV = Math.max(
                    1,
                    ...series.map((x) => x.volumeIndex),
                  );
                  const x =
                    pad +
                    (i / Math.max(1, series.length - 1)) * (W - pad * 2);
                  const y =
                    H - pad - (p.volumeIndex / maxV) * (H - pad * 2);
                  return `${x},${y}`;
                })
                .join(" ")}
            />
          </svg>
        ) : null}
      </div>

      <ProjectionTable series={series} provider={provider} />
    </div>
  );
}
