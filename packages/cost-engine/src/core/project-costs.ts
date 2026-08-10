/**
 * Multi-month cost projection (packages 15 + 20).
 * Must exist in core before createProjection API handler (plan hard dep).
 *
 * Package 20: 1–36 months, cumulative TCO, volumeElastic growth,
 * TU/Kinesis/PubSub step functions, low-confidence envelope.
 * No reserved-instance / CUD pricing implied.
 */
export const PROJECTION_MAX_MONTHS = 36;

/** Throughput capacity meters sized in integer units (TU / shard / PubSub capacity). */
export const THROUGHPUT_STEP_METER_IDS = new Set([
  "eh-standard-tu",
  "kinesis-shard-hour",
  "pubsub-message-delivery",
]);

/** Meters whose cost scales with volume growth (ingress / storage / events). */
export const VOLUME_ELASTIC_CAPABILITIES = new Set([
  "auditLogs",
  "egress",
  "dspm",
  "registry",
  "serverless",
]);

export type ProjectionLineItem = {
  provider: string;
  capability: string;
  meterId: string;
  amount: number;
  confidence: "High" | "Med" | "Low";
  /** Override: when true, annual growth applies. Default from capability map. */
  volumeElastic?: boolean;
};

export type ProjectCostsInput = {
  /** Monthly expected total (USD) from createEstimate. */
  monthlyExpected: number;
  /** Number of months to project (1–36). */
  months: number;
  /**
   * Annual growth percent applied as monthly compound to volumeElastic meters.
   * Negative values are floored at 0 (EDGE). Default 0 → flat.
   */
  annualGrowthPercent?: number;
  provider?: string;
  lineItems?: ProjectionLineItem[];
  /** Optional bands for Low-confidence envelope (hatched in UI). */
  monthlyLow?: number;
  monthlyHigh?: number;
};

export type ProjectionStackSlice = {
  provider: string;
  capability: string;
  meterId: string;
  amount: number;
  confidence: string;
};

export type ProjectionPoint = {
  /** 1-based month index. */
  month: number;
  expected: number;
  /** Cumulative TCO through this month (inclusive). */
  cumulative: number;
  /** Volume growth index (1.0 at month 1). */
  volumeIndex: number;
  low?: number;
  high?: number;
  /** Per-meter stack for stacked run-rate charts (when lineItems provided). */
  stacks?: ProjectionStackSlice[];
};

export type ProjectCostsResult = {
  series: ProjectionPoint[];
  /** Same rows as series — tabular / a11y export shape (AC). */
  table: ProjectionPoint[];
  /** Sum of series expected values (= last cumulative). */
  total: number;
  monthlyBaseline: number;
  annualGrowthPercent: number;
  disclaimer:
    "Indicative projection only. Does not imply reserved instance, savings plans, or CUD pricing.";
};

export function isVolumeElastic(item: ProjectionLineItem): boolean {
  if (typeof item.volumeElastic === "boolean") return item.volumeElastic;
  return VOLUME_ELASTIC_CAPABILITIES.has(item.capability);
}

export function isThroughputStepMeter(meterId: string): boolean {
  return THROUGHPUT_STEP_METER_IDS.has(meterId);
}

/**
 * Continuous volume growth factor for month (1-based).
 * Month 1 → 1.0.
 *
 * Verified: standard monthly-compounding conversion of an annual rate —
 * `monthlyRate = (1 + annual/100)^(1/12) - 1`, then compounded `month - 1` times so
 * `volumeGrowthFactor(13, g) === 1 + g/100` (i.e. the annual rate is fully realized
 * after 12 elapsed months, month 1 being the baseline). Negative growth is floored
 * to 0 by the caller-facing API (`projectCosts`), never inside this pure helper.
 * @param month 1-based month index (1 = baseline, no growth applied yet).
 * @param annualGrowthPercent Annual growth rate, e.g. 12 = 12%/yr. Must be >= 0 here.
 */
export function volumeGrowthFactor(
  month: number,
  annualGrowthPercent: number,
): number {
  const g = Math.max(0, annualGrowthPercent);
  if (g === 0) return 1;
  const monthlyRate = Math.pow(1 + g / 100, 1 / 12) - 1;
  return Math.pow(1 + monthlyRate, month - 1);
}

/**
 * Step capacity units for TU / Kinesis / PubSub: ceil(baseUnits × volumeIndex).
 * baseUnits inferred as 1 relative unit at month 1 for the line's amount.
 *
 * Verified intentional (not a rounding bug): because baseUnits is assumed to be
 * exactly 1 provisioned unit fully utilized at month 1, `ceil()` means *any*
 * volumeIndex > 1 — even a fractional-percent increase — steps the multiplier to 2
 * immediately, and it then holds flat at 2× until volumeIndex actually reaches 2.0.
 * This intentionally overstates near-term growth cost (fails closed / conservative)
 * rather than modeling partial headroom in the already-provisioned unit, which this
 * model has no way to know. Locked by the `TU / Kinesis / PubSub use step functions`
 * test in `core/__tests__/project-costs.test.ts` — do not "smooth" this without
 * updating that test and the product's confidence-banding policy.
 * @param volumeIndex Growth-relative volume, 1.0 at month 1 (see {@link volumeGrowthFactor}).
 * @returns Integer unit multiplier, minimum 1.
 */
export function steppedCapacityMultiplier(volumeIndex: number): number {
  if (!Number.isFinite(volumeIndex) || volumeIndex <= 0) return 1;
  return Math.max(1, Math.ceil(volumeIndex - 1e-12));
}

function projectLineAmount(
  item: ProjectionLineItem,
  month: number,
  annualGrowthPercent: number,
): number {
  const elastic = isVolumeElastic(item);
  if (!elastic || annualGrowthPercent === 0) return item.amount;

  const idx = volumeGrowthFactor(month, annualGrowthPercent);
  if (isThroughputStepMeter(item.meterId)) {
    return item.amount * steppedCapacityMultiplier(idx);
  }
  return item.amount * idx;
}

/**
 * Project monthly costs forward.
 * @throws if inputs invalid or months > 36
 */
export function projectCosts(input: ProjectCostsInput): ProjectCostsResult {
  const { monthlyExpected, months } = input;
  // EDGE: negative growth floored at 0
  const annualGrowthPercent = Math.max(0, input.annualGrowthPercent ?? 0);

  if (!Number.isFinite(monthlyExpected) || monthlyExpected < 0) {
    throw new Error("monthlyExpected must be a non-negative finite number");
  }
  if (!Number.isInteger(months) || months < 1) {
    throw new Error("months must be an integer >= 1");
  }
  if (months > PROJECTION_MAX_MONTHS) {
    throw new Error(
      `months must be <= ${PROJECTION_MAX_MONTHS} (got ${months})`,
    );
  }
  if (!Number.isFinite(input.annualGrowthPercent ?? 0)) {
    throw new Error("annualGrowthPercent must be finite");
  }

  const lineItems = input.lineItems;
  const series: ProjectionPoint[] = [];
  let cumulative = 0;

  for (let month = 1; month <= months; month++) {
    const volumeIndex = volumeGrowthFactor(month, annualGrowthPercent);
    let expected: number;
    let stacks: ProjectionStackSlice[] | undefined;
    let low: number | undefined;
    let high: number | undefined;

    if (lineItems && lineItems.length > 0) {
      stacks = lineItems.map((li) => ({
        provider: li.provider,
        capability: li.capability,
        meterId: li.meterId,
        amount: projectLineAmount(li, month, annualGrowthPercent),
        confidence: li.confidence,
      }));
      expected = stacks.reduce((s, x) => s + x.amount, 0);

      const hasLow = lineItems.some((li) => li.confidence === "Low");
      if (hasLow && input.monthlyLow != null && input.monthlyHigh != null) {
        const bandScale =
          monthlyExpected > 0 ? expected / monthlyExpected : volumeIndex;
        low = input.monthlyLow * bandScale;
        high = input.monthlyHigh * bandScale;
      }
    } else {
      expected =
        annualGrowthPercent === 0
          ? monthlyExpected
          : monthlyExpected * volumeIndex;
      if (input.monthlyLow != null && input.monthlyHigh != null) {
        low =
          annualGrowthPercent === 0
            ? input.monthlyLow
            : input.monthlyLow * volumeIndex;
        high =
          annualGrowthPercent === 0
            ? input.monthlyHigh
            : input.monthlyHigh * volumeIndex;
      }
    }

    cumulative += expected;
    series.push({
      month,
      expected,
      cumulative,
      volumeIndex,
      ...(low != null ? { low } : {}),
      ...(high != null ? { high } : {}),
      ...(stacks ? { stacks } : {}),
    });
  }

  const table = series.map((p) => ({
    ...p,
    stacks: p.stacks?.map((s) => ({ ...s })),
  }));

  return {
    series,
    table,
    total: cumulative,
    monthlyBaseline: monthlyExpected,
    annualGrowthPercent,
    disclaimer:
      "Indicative projection only. Does not imply reserved instance, savings plans, or CUD pricing.",
  };
}
