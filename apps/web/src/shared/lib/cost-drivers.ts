/**
 * Aggregate line items by capability for cost-driver view (package 27).
 */
export type CostDriverLine = {
  capability: string;
  amount: number;
  confidence: string;
};

export type CostDriverRow = {
  capability: string;
  amount: number;
  percent: number;
  confidence: "High" | "Med" | "Low";
};

const CONF_RANK: Record<string, number> = { High: 0, Med: 1, Low: 2 };

/**
 * Aggregate line items into one row per capability, sorted highest cost first.
 *
 * - `amount` per capability = sum of that capability's line-item amounts.
 * - `percent` = `amount / total * 100`, where `total` is `estimate.totals.expected`
 *   (the engine's authoritative total, not a re-sum of `items`) so displayed
 *   percentages always agree with the engine, not just with each other; falls
 *   back to `sum(items.amount)` only when no `estimate` is given. `total <= 0`
 *   yields `percent: 0` for every row instead of dividing by zero.
 * - `confidence` per capability = the *lowest* confidence among its merged
 *   lines (High=0 < Med=1 < Low=2) — conservative, so one weak meter downgrades
 *   the whole capability's badge.
 * - Sort is descending by `amount`; ties keep first-seen order (stable sort).
 *
 * @param estimate Source of the engine total and, when `rows` is omitted, the line items.
 * @param rows Optional override line items (e.g. breakdown rows with $0 placeholders
 *   merged in) — must sum to the same total as `estimate.lineItems` or percentages
 *   will not reflect `estimate.totals.expected`.
 * @returns One row per distinct capability, descending by amount; `[]` when there are no items.
 */
export function aggregateCostDrivers(
  estimate: { totals: { expected: number }; lineItems: CostDriverLine[] } | null,
  rows?: CostDriverLine[],
): CostDriverRow[] {
  const items =
    rows ??
    estimate?.lineItems.map((li) => ({
      capability: li.capability,
      amount: li.amount,
      confidence: li.confidence,
    })) ??
    [];
  if (items.length === 0) return [];

  const total =
    estimate?.totals.expected ??
    items.reduce((s, i) => s + i.amount, 0);
  const byCap = new Map<string, { amount: number; confidence: string }>();

  for (const li of items) {
    const prev = byCap.get(li.capability);
    if (!prev) {
      byCap.set(li.capability, { amount: li.amount, confidence: li.confidence });
    } else {
      prev.amount += li.amount;
      if (CONF_RANK[li.confidence] > CONF_RANK[prev.confidence]) {
        prev.confidence = li.confidence;
      }
    }
  }

  const drivers: CostDriverRow[] = [...byCap.entries()].map(([capability, v]) => ({
    capability,
    amount: v.amount,
    percent: total > 0 ? (v.amount / total) * 100 : 0,
    confidence: v.confidence as CostDriverRow["confidence"],
  }));

  drivers.sort((a, b) => b.amount - a.amount);
  return drivers;
}
