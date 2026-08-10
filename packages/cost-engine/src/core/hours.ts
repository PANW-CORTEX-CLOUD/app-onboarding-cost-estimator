/**
 * Generic month-hours & peak-factor conventions (package 05).
 * Provider stream formulas (EH / Kinesis / PubSub) consume these — no cloud-specific logic here.
 *
 * Locked default: 730 hours/month. Never silently substitute 720.
 * Peak factor scales throughput recommendations only — not average event volume.
 *
 * Verified: 730 = 8,760 hours/year ÷ 12 is the documented billing convention used
 * by both major hyperscalers for always-on hourly meters (not 720 = 30×24, which
 * undercounts by omitting the ~0.44 fractional days/month average).
 * @see https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/pricing-calculator
 * @see https://aws.amazon.com/calculator/calculator-assumptions/ (AWS Pricing Calculator assumes 730 hours/month = 365×24/12)
 */

/** Industry average month hours — locked core default (AC). */
export const DEFAULT_MONTH_HOURS = 730 as const;

/** 31-day calendar month hours. */
export const MONTH_HOURS_31_DAY = 744 as const;

/** Forbidden silent default (EDGE) — callers must not get 720 without explicit choice. */
export const FORBIDDEN_SILENT_MONTH_HOURS = 720 as const;

export type MonthHoursConvention = "730" | "744" | "actual";

export type ResolveMonthHoursInput = {
  /** Convention selector. Defaults to "730". */
  convention?: MonthHoursConvention;
  /**
   * Explicit hours override. When set, must be a positive finite number.
   * Passing 720 throws (EDGE: do not silently use 720).
   */
  monthHours?: number;
  /** Calendar year for `actual` (UTC). Required when convention is `actual`. */
  year?: number;
  /** Calendar month 1–12 for `actual` (UTC). Required when convention is `actual`. */
  month?: number;
};

export type ResolvedMonthHours = {
  monthHours: number;
  convention: MonthHoursConvention;
  /** UI/API label for the active convention. */
  label: string;
  /** daysInMonth when convention is actual; otherwise undefined. */
  daysInMonth?: number;
};

/**
 * Days in a UTC calendar month. Leap years: Feb → 29.
 * @param year Full year (e.g. 2024)
 * @param month 1–12
 */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || year < 1) {
    throw new Error(`daysInMonth: invalid year ${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`daysInMonth: month must be 1–12, got ${month}`);
  }
  // Date.UTC day 0 of next month = last day of this month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29;
}

/**
 * Resolve monthHours from convention or explicit override.
 * Default locked to 730. Rejects silent 720.
 */
export function resolveMonthHours(
  input: ResolveMonthHoursInput = {},
): ResolvedMonthHours {
  if (input.monthHours !== undefined) {
    if (!Number.isFinite(input.monthHours) || input.monthHours <= 0) {
      throw new Error(
        `monthHours must be a positive finite number, got ${input.monthHours}`,
      );
    }
    if (input.monthHours === FORBIDDEN_SILENT_MONTH_HOURS) {
      throw new Error(
        "monthHours=720 is not a supported silent default; use 730, 744, or actual daysInMonth×24",
      );
    }
    const convention: MonthHoursConvention =
      input.monthHours === DEFAULT_MONTH_HOURS
        ? "730"
        : input.monthHours === MONTH_HOURS_31_DAY
          ? "744"
          : (input.convention ?? "actual");
    return {
      monthHours: input.monthHours,
      convention,
      label: labelForMonthHours(convention, input.monthHours),
    };
  }

  const convention = input.convention ?? "730";
  if (convention === "730") {
    return {
      monthHours: DEFAULT_MONTH_HOURS,
      convention: "730",
      label: labelForMonthHours("730", DEFAULT_MONTH_HOURS),
    };
  }
  if (convention === "744") {
    return {
      monthHours: MONTH_HOURS_31_DAY,
      convention: "744",
      label: labelForMonthHours("744", MONTH_HOURS_31_DAY),
    };
  }
  // actual
  if (input.year === undefined || input.month === undefined) {
    throw new Error(
      "convention 'actual' requires year and month (1–12) for daysInMonth",
    );
  }
  const dim = daysInMonth(input.year, input.month);
  const monthHours = dim * 24;
  return {
    monthHours,
    convention: "actual",
    daysInMonth: dim,
    label: labelForMonthHours("actual", monthHours, dim, input.year, input.month),
  };
}

/** Human-readable label for UI/API (AC). */
export function labelForMonthHours(
  convention: MonthHoursConvention,
  monthHours: number,
  days?: number,
  year?: number,
  month?: number,
): string {
  if (convention === "730") {
    return `${monthHours} hours (industry average month)`;
  }
  if (convention === "744") {
    return `${monthHours} hours (31-day month)`;
  }
  const dayPart = days !== undefined ? `${days}-day` : "calendar";
  const when =
    year !== undefined && month !== undefined
      ? ` ${year}-${String(month).padStart(2, "0")}`
      : "";
  return `${monthHours} hours (actual ${dayPart} month${when})`;
}

/**
 * Hourly capacity billing: units × unitPricePerHour × monthHours (linear in monthHours).
 */
export function scaleHourlyCost(
  units: number,
  unitPricePerHour: number,
  monthHours: number = DEFAULT_MONTH_HOURS,
): number {
  assertPositiveFinite(units, "units");
  assertNonNegFinite(unitPricePerHour, "unitPricePerHour");
  assertPositiveFinite(monthHours, "monthHours");
  return units * unitPricePerHour * monthHours;
}

/**
 * Snapshot / one-shot capacity prorated into a month:
 * gb × pricePerGbMonth × (lifetimeHours / monthHours).
 * Linear in 1/monthHours for fixed lifetimeHours.
 */
export function prorateSnapshotCost(
  gb: number,
  pricePerGbMonth: number,
  lifetimeHours: number,
  monthHours: number = DEFAULT_MONTH_HOURS,
): number {
  assertNonNegFinite(gb, "gb");
  assertNonNegFinite(pricePerGbMonth, "pricePerGbMonth");
  assertNonNegFinite(lifetimeHours, "lifetimeHours");
  assertPositiveFinite(monthHours, "monthHours");
  return gb * pricePerGbMonth * (lifetimeHours / monthHours);
}

export type PeakFactorInput = {
  /** Sustained / average ingress volume (events/sec or GB/day — caller units). */
  averageVolume: number;
  /**
   * Peak multiplier for throughput sizing (e.g. 2 = 2× peak vs average).
   * Must be >= 1. Default 1 (no uplift).
   */
  peakFactor?: number;
};

export type PeakFactorResult = {
  /** Unchanged average volume — peak must not multiply base event volume (TEST). */
  averageVolume: number;
  /** Throughput recommendation = averageVolume × peakFactor. */
  peakThroughputRecommendation: number;
  peakFactor: number;
  /**
   * Separate auto-inflate / peak capacity cost uplift vs average utilization cost.
   * averageUtilizationCostRatio = 1; peakCapacityCostRatio = peakFactor.
   */
  averageUtilizationCostRatio: number;
  peakCapacityCostRatio: number;
};

/**
 * Split average utilization from peak throughput sizing.
 * Peak factor doubles (or N×) throughput recommendation without multiplying base volume.
 */
export function applyPeakFactor(input: PeakFactorInput): PeakFactorResult {
  assertNonNegFinite(input.averageVolume, "averageVolume");
  const peakFactor = input.peakFactor ?? 1;
  if (!Number.isFinite(peakFactor) || peakFactor < 1) {
    throw new Error(`peakFactor must be >= 1, got ${peakFactor}`);
  }
  return {
    averageVolume: input.averageVolume,
    peakThroughputRecommendation: input.averageVolume * peakFactor,
    peakFactor,
    averageUtilizationCostRatio: 1,
    peakCapacityCostRatio: peakFactor,
  };
}

/**
 * Peak capacity cost is billed separately from average utilization cost (EDGE).
 * @returns { averageCost, peakUpliftCost, totalCost } where peakUplift is the
 * incremental cost of provisioning for peak (not a silent multiply of average volume).
 */
export function splitAverageAndPeakCost(opts: {
  averageUtilizationCost: number;
  peakFactor?: number;
}): {
  averageCost: number;
  peakUpliftCost: number;
  totalCost: number;
  peakFactor: number;
} {
  assertNonNegFinite(opts.averageUtilizationCost, "averageUtilizationCost");
  const peakFactor = opts.peakFactor ?? 1;
  if (!Number.isFinite(peakFactor) || peakFactor < 1) {
    throw new Error(`peakFactor must be >= 1, got ${peakFactor}`);
  }
  const averageCost = opts.averageUtilizationCost;
  // Uplift only: (peakFactor - 1) × average — peak inflate separate from average
  const peakUpliftCost = averageCost * (peakFactor - 1);
  return {
    averageCost,
    peakUpliftCost,
    totalCost: averageCost + peakUpliftCost,
    peakFactor,
  };
}

function assertPositiveFinite(n: number, name: string): void {
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive finite number, got ${n}`);
  }
}

function assertNonNegFinite(n: number, name: string): void {
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative finite number, got ${n}`);
  }
}
