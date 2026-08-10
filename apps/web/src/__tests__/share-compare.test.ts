/**
 * Package 21 — share-state + compare delta unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  compareDelta,
  deserializeShareState,
  serializeShareState,
  validateShareState,
  type ShareState,
  MAX_SHARE_URL_CHARS,
} from "../shared/lib/share-state.ts";
import { writeLocalJson } from "../shared/lib/safe-storage.ts";

const sample: ShareState = {
  v: 1,
  provider: "azure",
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: { accountCount: 10, ingressGBPerDay: 5 },
  totals: { expected: 42 },
  mode: "providers",
};

describe("package 21 — share & compare", () => {
  it("round-trips serialize/deserialize multi-cloud inputs", () => {
    for (const provider of ["azure", "aws", "gcp"] as const) {
      const state = { ...sample, provider };
      const enc = serializeShareState(state);
      const back = deserializeShareState(enc);
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.state.provider).toBe(provider);
        expect(back.state.volume.accountCount).toBe(10);
        expect(back.state.totals?.expected).toBe(42);
      }
    }
  });

  it("compare delta matches math", () => {
    expect(compareDelta(100, 150)).toEqual({ absolute: 50, percent: 50 });
    expect(compareDelta(0, 10)).toEqual({ absolute: 10, percent: null });
  });

  it("oversized URLs fall back to JSON export", () => {
    const huge: ShareState = {
      ...sample,
      volume: {
        ...sample.volume,
        // pad to force oversized URL
        accountCount: 10,
      },
    };
    // Force oversized by checking buildShareUrl with tiny max via long region
    const long = {
      ...huge,
      region: "x".repeat(MAX_SHARE_URL_CHARS),
    };
    const built = buildShareUrl(long, "https://example.com/");
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.reason).toBe("oversized");
      expect(built.json).toContain('"provider": "azure"');
    }
  });

  it("rejects secrets in share payload", () => {
    expect(() =>
      serializeShareState({
        ...sample,
        apiKey: "secret-token-value",
      } as unknown as ShareState),
    ).toThrow(/secret/i);
  });

  it("malformed share returns error", () => {
    const bad = deserializeShareState("!!!not-base64!!!");
    expect(bad.ok).toBe(false);
  });

  it("localStorage write helper returns ok on success", () => {
    const r = writeLocalJson("cloud-connector:test-key", { a: 1 });
    expect(r.ok).toBe(true);
  });
});

describe("package 21 — share payload runtime validation", () => {
  it("accepts a well-formed payload", () => {
    expect(validateShareState(sample).ok).toBe(true);
  });

  it("rejects a negative volume value rather than passing it to a setter", () => {
    const bad = validateShareState({
      ...sample,
      volume: { ...sample.volume, dataEstateGB: -999 },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/dataEstateGB/);
  });

  it("rejects a non-numeric volume value", () => {
    const bad = validateShareState({
      ...sample,
      volume: { accountCount: "10" },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/accountCount/);
  });

  it("rejects a non-finite volume value", () => {
    expect(
      validateShareState({ ...sample, volume: { peakMBps: Number.NaN } }).ok,
    ).toBe(false);
  });

  it("rejects a non-boolean capability flag", () => {
    const bad = validateShareState({
      ...sample,
      capabilities: { auditLogs: "yes" },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/auditLogs/);
  });

  it("rejects non-object and wrong-typed top-level fields", () => {
    expect(validateShareState(null).ok).toBe(false);
    expect(validateShareState("nope").ok).toBe(false);
    expect(validateShareState({ ...sample, region: "" }).ok).toBe(false);
    expect(validateShareState({ ...sample, provider: "oracle" }).ok).toBe(false);
    expect(validateShareState({ ...sample, mode: "sideways" }).ok).toBe(false);
  });

  it("a malformed payload cannot survive a serialize round-trip either", () => {
    // deserializeShareState delegates to the same validator, so a hand-edited
    // ?s= carrying a negative estate is rejected at parse time, not later.
    const encoded = serializeShareState({
      ...sample,
      volume: { ...sample.volume, dataEstateGB: -1 },
    });
    expect(deserializeShareState(encoded).ok).toBe(false);
  });
});
