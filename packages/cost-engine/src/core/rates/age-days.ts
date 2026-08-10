/**
 * Rate-card age + UI freshness banners (packages 04 / 16).
 * Generic core — no provider fetch.
 */

/** Fallback capturedAt older than this → CI age gate fail (package 04 / 16). */
export const FALLBACK_MAX_AGE_DAYS = 90;

/** Package 16 — warn banner when ageDays > this. */
export const STALE_DAYS_WARN = 7;

/** Package 16 — critical banner; export requires explicit Ack. */
export const STALE_DAYS_CRITICAL = 30;

/** In-memory rates cache TTL (package 16 REQ). */
export const RATES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type FreshnessLevel = "fresh" | "warn" | "critical";

export type RatesFreshness = {
  ageDays: number;
  level: FreshnessLevel;
  /** Human banner for UI RatesFreshnessBanner (pkg 17). */
  banner: string | null;
  /** AC: critical-stale fallback/cache requires Ack before export. */
  requiresAckBeforeExport: boolean;
};

/**
 * Whole days between capturedAt ISO timestamp and `now` (UTC calendar floor).
 * Invalid timestamps return Number.POSITIVE_INFINITY so callers fail closed to stale.
 */
export function ageDaysFromCapturedAt(
  capturedAt: string,
  now: Date = new Date(),
): number {
  const then = Date.parse(capturedAt);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  const ms = Math.max(0, now.getTime() - then);
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** @returns warning string when age exceeds FALLBACK_MAX_AGE_DAYS; else undefined */
export function staleFallbackWarning(
  capturedAt: string,
  now: Date = new Date(),
): string | undefined {
  const age = ageDaysFromCapturedAt(capturedAt, now);
  if (age > FALLBACK_MAX_AGE_DAYS) {
    return `fallback capturedAt ageDays=${age} exceeds ${FALLBACK_MAX_AGE_DAYS}`;
  }
  return undefined;
}

/**
 * Evaluate rates freshness for banners / export gate (package 16 AC).
 */
export function evaluateRatesFreshness(
  capturedAt: string,
  ratesSource: "live" | "cache" | "fallback",
  now: Date = new Date(),
): RatesFreshness {
  const ageDays = ageDaysFromCapturedAt(capturedAt, now);
  let level: FreshnessLevel = "fresh";
  if (ageDays > STALE_DAYS_CRITICAL) level = "critical";
  else if (ageDays > STALE_DAYS_WARN) level = "warn";

  let banner: string | null = null;
  if (level === "warn") {
    banner = `Rates are ${ageDays} days old (warn >${STALE_DAYS_WARN}d); source=${ratesSource}`;
  } else if (level === "critical") {
    banner = `Rates are critically stale (${ageDays}d >${STALE_DAYS_CRITICAL}d); source=${ratesSource} — Ack required before export`;
  }

  return {
    ageDays,
    level,
    banner,
    requiresAckBeforeExport: level === "critical",
  };
}

/**
 * Fail closed when exporting with critical-stale rates without Ack (AC).
 */
export function assertExportAllowedForFreshness(
  freshness: RatesFreshness,
  opts: { ackCriticalStale?: boolean } = {},
): void {
  if (freshness.requiresAckBeforeExport && opts.ackCriticalStale !== true) {
    throw new Error(
      "critical-stale rates require Ack before export (ackCriticalStale=true)",
    );
  }
}
