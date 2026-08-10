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
