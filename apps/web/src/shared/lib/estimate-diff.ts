/**
 * Per-meter diff between two estimates — "what changed since the last quote, and
 * which meter caused it?", the first question every reviewer asks.
 *
 * `compareDelta` (share-state.ts) answers this at the *total* level; this answers
 * it line by line: which meters were added, removed, or moved, and by how much.
 * It is a pure function over two estimate-shaped inputs, so it works on a live
 * estimate vs the cached previous one, or on any two frozen exports.
 *
 * Keying: a `meterId` is **not** unique within one estimate (GCP bills
 * `gcp-egress-gb` on more than one line), so lines are aggregated by
 * `capability/meterId` and their amounts summed. That keeps "how much did this
 * meter cost, before vs after" correct even when a meter appears more than once.
 */

/** The minimum an estimate must expose to be diffable. */
export type DiffableEstimate = {
  lineItems: readonly { capability: string; meterId: string; amount: number }[];
  totals: { expected: number };
};

export type MeterDiffStatus = "added" | "removed" | "changed" | "unchanged";

export type MeterDiff = {
  capability: string;
  meterId: string;
  /** Aggregated amount in the earlier estimate; `null` when the meter is new. */
  before: number | null;
  /** Aggregated amount in the later estimate; `null` when the meter is gone. */
  after: number | null;
  /** `(after ?? 0) - (before ?? 0)`. */
  delta: number;
  status: MeterDiffStatus;
};

export type EstimateDiff = {
  meters: MeterDiff[];
  totalBefore: number;
  totalAfter: number;
  totalDelta: number;
};

/** Sum line amounts by `capability/meterId`, skipping non-finite amounts. */
function aggregateByMeter(
  estimate: DiffableEstimate,
): Map<string, { capability: string; meterId: string; amount: number }> {
  const map = new Map<
    string,
    { capability: string; meterId: string; amount: number }
  >();
  for (const li of estimate.lineItems) {
    if (!Number.isFinite(li.amount)) continue;
    const key = `${li.capability}/${li.meterId}`;
    const existing = map.get(key);
    if (existing) existing.amount += li.amount;
    else
      map.set(key, {
        capability: li.capability,
        meterId: li.meterId,
        amount: li.amount,
      });
  }
  return map;
}

/** Amounts within this many dollars are treated as unchanged (float noise). */
const CHANGE_EPSILON = 0.005;

/**
 * Diff `after` against `before`, per meter.
 *
 * @returns meters sorted by absolute delta (biggest movers first), then by key
 *   for stability; plus the before/after totals and their delta.
 */
export function diffEstimates(
  before: DiffableEstimate,
  after: DiffableEstimate,
): EstimateDiff {
  const beforeMap = aggregateByMeter(before);
  const afterMap = aggregateByMeter(after);
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const meters: MeterDiff[] = [];
  for (const key of keys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    const beforeAmt = b ? b.amount : null;
    const afterAmt = a ? a.amount : null;
    const delta = (afterAmt ?? 0) - (beforeAmt ?? 0);

    let status: MeterDiffStatus;
    if (beforeAmt === null) status = "added";
    else if (afterAmt === null) status = "removed";
    else if (Math.abs(delta) > CHANGE_EPSILON) status = "changed";
    else status = "unchanged";

    meters.push({
      capability: (a ?? b)!.capability,
      meterId: (a ?? b)!.meterId,
      before: beforeAmt,
      after: afterAmt,
      delta,
      status,
    });
  }

  meters.sort(
    (x, y) =>
      Math.abs(y.delta) - Math.abs(x.delta) ||
      `${x.capability}/${x.meterId}`.localeCompare(`${y.capability}/${y.meterId}`),
  );

  const totalBefore = before.totals.expected;
  const totalAfter = after.totals.expected;
  return {
    meters,
    totalBefore,
    totalAfter,
    totalDelta: totalAfter - totalBefore,
  };
}

/** True when nothing of substance moved — lets the UI skip an empty panel. */
export function isNoOpDiff(diff: EstimateDiff): boolean {
  return (
    Math.abs(diff.totalDelta) <= CHANGE_EPSILON &&
    diff.meters.every((m) => m.status === "unchanged")
  );
}
