/**
 * Per-meter estimate diff — added / removed / changed / unchanged, biggest
 * mover first, with totals that reconcile.
 */
import { describe, expect, it } from "vitest";
import {
  diffEstimates,
  isNoOpDiff,
  type DiffableEstimate,
} from "../estimate-diff.ts";

function est(
  lineItems: DiffableEstimate["lineItems"],
  expected: number,
): DiffableEstimate {
  return { lineItems, totals: { expected } };
}

describe("diffEstimates", () => {
  it("classifies added, removed, changed and unchanged meters", () => {
    const before = est(
      [
        { capability: "audit_logs", meterId: "eh-tu", amount: 100 },
        { capability: "dspm", meterId: "s3-get", amount: 50 },
        { capability: "ads_cloud", meterId: "ebs-snap", amount: 10 },
      ],
      160,
    );
    const after = est(
      [
        { capability: "audit_logs", meterId: "eh-tu", amount: 100 }, // unchanged
        { capability: "dspm", meterId: "s3-get", amount: 80 }, // changed +30
        { capability: "registry", meterId: "egress", amount: 5 }, // added
        // ads_cloud/ebs-snap removed
      ],
      185,
    );
    const d = diffEstimates(before, after);
    const byKey = Object.fromEntries(
      d.meters.map((m) => [`${m.capability}/${m.meterId}`, m]),
    );
    expect(byKey["audit_logs/eh-tu"]!.status).toBe("unchanged");
    expect(byKey["dspm/s3-get"]!.status).toBe("changed");
    expect(byKey["dspm/s3-get"]!.delta).toBe(30);
    expect(byKey["registry/egress"]!.status).toBe("added");
    expect(byKey["registry/egress"]!.before).toBeNull();
    expect(byKey["ads_cloud/ebs-snap"]!.status).toBe("removed");
    expect(byKey["ads_cloud/ebs-snap"]!.after).toBeNull();
    expect(d.totalDelta).toBe(25);
  });

  it("sorts by absolute delta, biggest mover first", () => {
    const before = est(
      [
        { capability: "a", meterId: "m1", amount: 10 },
        { capability: "b", meterId: "m2", amount: 100 },
      ],
      110,
    );
    const after = est(
      [
        { capability: "a", meterId: "m1", amount: 15 }, // +5
        { capability: "b", meterId: "m2", amount: 40 }, // -60
      ],
      55,
    );
    const d = diffEstimates(before, after);
    expect(d.meters[0]!.meterId).toBe("m2"); // |−60| > |+5|
    expect(d.meters[0]!.delta).toBe(-60);
  });

  it("aggregates a meter that appears more than once (e.g. GCP double egress)", () => {
    const before = est(
      [{ capability: "audit_logs", meterId: "gcp-egress-gb", amount: 4 }],
      4,
    );
    const after = est(
      [
        { capability: "audit_logs", meterId: "gcp-egress-gb", amount: 4 },
        { capability: "audit_logs", meterId: "gcp-egress-gb", amount: 6 },
      ],
      10,
    );
    const d = diffEstimates(before, after);
    const egress = d.meters.find((m) => m.meterId === "gcp-egress-gb")!;
    expect(egress.before).toBe(4);
    expect(egress.after).toBe(10); // 4 + 6 summed
    expect(egress.delta).toBe(6);
  });

  it("EDGE: sub-cent movement is unchanged, not a spurious change", () => {
    const before = est([{ capability: "a", meterId: "m", amount: 10.0 }], 10);
    const after = est([{ capability: "a", meterId: "m", amount: 10.004 }], 10.004);
    const d = diffEstimates(before, after);
    expect(d.meters[0]!.status).toBe("unchanged");
    expect(isNoOpDiff(d)).toBe(true);
  });

  it("EDGE: non-finite amounts are skipped, not propagated as NaN", () => {
    const before = est([{ capability: "a", meterId: "m", amount: 10 }], 10);
    const after = est(
      [
        { capability: "a", meterId: "m", amount: 10 },
        { capability: "b", meterId: "bad", amount: Number.NaN },
      ],
      10,
    );
    const d = diffEstimates(before, after);
    expect(d.meters.some((m) => m.meterId === "bad")).toBe(false);
    expect(Number.isFinite(d.totalDelta)).toBe(true);
  });

  it("EDGE: two identical estimates diff to a no-op", () => {
    const e = est(
      [{ capability: "audit_logs", meterId: "eh-tu", amount: 100 }],
      100,
    );
    const d = diffEstimates(e, e);
    expect(isNoOpDiff(d)).toBe(true);
    expect(d.totalDelta).toBe(0);
  });
});
