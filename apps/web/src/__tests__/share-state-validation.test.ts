/**
 * A share link is user-editable text.
 *
 * `deserializeShareState` used to check `v`, `provider` and `region` and cast
 * the rest, so a hand-edited `?s=` put arbitrary values straight into React
 * state setters: a negative estate, a NaN, or a string sat in the form looking
 * like a real number until the API rejected it at submit time.
 *
 * On prototype pollution: `JSON.parse` yields `__proto__` as an own property
 * rather than mutating `Object.prototype`, and the page merges capabilities
 * with object spread, which defines rather than assigns — so this was never a
 * pollution vector. The allowlist still drops such keys, and the test below
 * proves the prototype stays clean either way.
 */
import { describe, expect, it } from "vitest";
import {
  deserializeShareState,
  serializeShareState,
  validateShareState,
  type ShareState,
} from "../shared/lib/share-state.ts";

const valid: ShareState = {
  v: 1,
  provider: "azure",
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: { accountCount: 25, dataEstateGB: 1024 },
};

describe("a well-formed link still round-trips", () => {
  it("survives serialize then deserialize unchanged", () => {
    const r = deserializeShareState(serializeShareState(valid));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.provider).toBe("azure");
    expect(r.state.volume.accountCount).toBe(25);
    expect(r.state.capabilities.auditLogs).toBe(true);
    expect(r.rejectedFields).toBeUndefined();
  });
});

describe("numeric fields are bounded before they reach a state setter", () => {
  it("EDGE: a negative value is dropped and named", () => {
    const r = validateShareState({ ...valid, volume: { dataEstateGB: -999 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume.dataEstateGB).toBeUndefined();
    expect(r.rejectedFields).toContain("dataEstateGB");
  });

  it("EDGE: NaN and Infinity are dropped", () => {
    const r = validateShareState({
      ...valid,
      volume: { accountCount: Number.NaN, egressGB: Number.POSITIVE_INFINITY },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume.accountCount).toBeUndefined();
    expect(r.state.volume.egressGB).toBeUndefined();
    expect(r.rejectedFields).toEqual(
      expect.arrayContaining(["accountCount", "egressGB"]),
    );
  });

  it("EDGE: a string where a number belongs is dropped, not coerced", () => {
    const r = validateShareState({
      ...valid,
      volume: { accountCount: "50" as unknown as number },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume.accountCount).toBeUndefined();
  });

  it("EDGE: an absurd magnitude is dropped", () => {
    const r = validateShareState({ ...valid, volume: { pctScanned: 100_000 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume.pctScanned).toBeUndefined();
  });

  it("EDGE: zero and the exact upper bound are kept — they are legitimate", () => {
    const r = validateShareState({
      ...valid,
      volume: { egressGB: 0, pctScanned: 100 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume.egressGB).toBe(0);
    expect(r.state.volume.pctScanned).toBe(100);
    expect(r.rejectedFields).toBeUndefined();
  });
});

describe("only declared keys survive", () => {
  it("an unknown volume key is dropped without failing the whole link", () => {
    const r = validateShareState({
      ...valid,
      volume: { accountCount: 5, somethingElse: 9 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume.accountCount).toBe(5);
    expect("somethingElse" in r.state.volume).toBe(false);
  });

  it("a non-boolean capability is dropped", () => {
    const r = validateShareState({
      ...valid,
      capabilities: { auditLogs: "yes" as unknown as boolean, dspm: true },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.capabilities.auditLogs).toBeUndefined();
    expect(r.state.capabilities.dspm).toBe(true);
  });

  it("EDGE: a __proto__ key is not copied and the prototype stays clean", () => {
    const payload = JSON.parse(
      '{"v":1,"provider":"azure","region":"eastus","capabilities":{"__proto__":{"polluted":true}},"volume":{"__proto__":{"polluted":true}}}',
    ) as unknown;
    const r = validateShareState(payload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      ({} as Record<string, unknown>).polluted,
      "Object.prototype must be untouched",
    ).toBeUndefined();
    expect(Object.keys(r.state.volume)).toStrictEqual([]);
  });

  it("EDGE: an array where an object belongs yields empty, not a crash", () => {
    const r = validateShareState({
      ...valid,
      volume: [1, 2, 3],
      capabilities: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.volume).toStrictEqual({});
    expect(r.state.capabilities).toStrictEqual({});
  });
});

describe("structurally wrong payloads are refused outright", () => {
  it("wrong version, missing region, unknown provider", () => {
    expect(validateShareState({ ...valid, v: 2 }).ok).toBe(false);
    expect(validateShareState({ ...valid, region: "" }).ok).toBe(false);
    expect(validateShareState({ ...valid, provider: "oracle" }).ok).toBe(false);
  });

  it("EDGE: a non-object payload is refused rather than throwing", () => {
    expect(validateShareState(null).ok).toBe(false);
    expect(validateShareState([1, 2]).ok).toBe(false);
    expect(validateShareState("nope").ok).toBe(false);
  });

  it("EDGE: totals with a non-finite expected are dropped, not rendered as NaN", () => {
    const r = validateShareState({ ...valid, totals: { expected: Number.NaN } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.totals).toBeUndefined();
  });
});
