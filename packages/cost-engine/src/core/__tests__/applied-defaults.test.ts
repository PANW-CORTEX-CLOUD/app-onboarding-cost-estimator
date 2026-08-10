/**
 * T-5.1.2 — a default nobody sees is a guess presented as a fact.
 *
 * These pin two things: that only *substituted* values are reported (an
 * explicit input, including an explicit zero, is the customer's own), and that
 * a default can never reach a customer without an explanation attached.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_METADATA,
  DefaultsTracker,
} from "../applied-defaults.ts";

describe("recording only what was guessed", () => {
  it("a supplied value is used and not reported", () => {
    const d = new DefaultsTracker();
    expect(d.resolve("volume.accountCount", 42, 10)).toBe(42);
    expect(d.list()).toStrictEqual([]);
  });

  it("EDGE: an explicit zero is the customer's choice, not a default", () => {
    const d = new DefaultsTracker();
    expect(d.resolve("volume.pctScanned", 0, 10)).toBe(0);
    expect(d.list()).toStrictEqual([]);
  });

  it("an absent value falls back and is reported with its rationale", () => {
    const d = new DefaultsTracker();
    expect(d.resolve("volume.accountCount", undefined, 10)).toBe(10);
    const [entry] = d.list();
    expect(entry?.field).toBe("volume.accountCount");
    expect(entry?.value).toBe(10);
    expect(entry?.kind).toBe("assumption");
    expect(entry?.rationale.length).toBeGreaterThan(20);
  });

  it("EDGE: the same field resolved twice is reported once", () => {
    // Several capabilities share scansPerMonth in one estimate.
    const d = new DefaultsTracker();
    d.resolve("volume.scansPerMonth", undefined, 4);
    d.resolve("volume.scansPerMonth", undefined, 1);
    expect(d.list()).toHaveLength(1);
  });

  it("conventions are listed before assumptions so guesses stand out", () => {
    const d = new DefaultsTracker();
    d.resolve("volume.accountCount", undefined, 10);
    d.resolve("monthHours", undefined, 730);
    expect(d.list().map((a) => a.kind)).toStrictEqual([
      "convention",
      "assumption",
    ]);
  });

  it("assumptions() excludes billing conventions", () => {
    const d = new DefaultsTracker();
    d.resolve("monthHours", undefined, 730);
    d.resolve("volume.accountCount", undefined, 10);
    expect(d.assumptions().map((a) => a.field)).toStrictEqual([
      "volume.accountCount",
    ]);
  });

  it("EDGE: a default with no metadata fails loudly rather than shipping unexplained", () => {
    // This is the drift guard: adding a default without a rationale cannot
    // silently reach a customer as a bare number.
    const d = new DefaultsTracker();
    expect(() => d.resolve("volume.somethingNew", undefined, 5)).toThrow(
      /no entry in DEFAULT_METADATA/,
    );
  });
});

describe("every documented default is usable and explained", () => {
  it("each entry has a label, a kind and a real rationale", () => {
    for (const [field, meta] of Object.entries(DEFAULT_METADATA)) {
      expect(meta.label.length, field).toBeGreaterThan(2);
      expect(["convention", "assumption"]).toContain(meta.kind);
      expect(
        meta.rationale.length,
        `${field} rationale is too short to be useful`,
      ).toBeGreaterThan(30);
    }
  });

  it("730 hours is a convention, estate guesses are assumptions", () => {
    expect(DEFAULT_METADATA.monthHours?.kind).toBe("convention");
    expect(DEFAULT_METADATA["volume.accountCount"]?.kind).toBe("assumption");
    expect(DEFAULT_METADATA["volume.avgObjectSizeMB"]?.kind).toBe("assumption");
  });
});
