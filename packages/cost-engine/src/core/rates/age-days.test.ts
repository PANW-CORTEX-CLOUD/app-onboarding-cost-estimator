/**
 * Core ageDays helpers (package 04).
 */
import { describe, expect, it } from "vitest";
import {
  ageDaysFromCapturedAt,
  staleFallbackWarning,
  FALLBACK_MAX_AGE_DAYS,
} from "./age-days.ts";

describe("ageDaysFromCapturedAt", () => {
  it("floors whole UTC days", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    expect(ageDaysFromCapturedAt("2026-07-01T00:00:00.000Z", now)).toBe(27);
  });

  it("invalid timestamp → Infinity (fail closed stale)", () => {
    expect(ageDaysFromCapturedAt("not-a-date")).toBe(Number.POSITIVE_INFINITY);
  });

  it("staleFallbackWarning when >90 days", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    expect(staleFallbackWarning("2026-01-01T00:00:00.000Z", now)).toMatch(
      String(FALLBACK_MAX_AGE_DAYS),
    );
    expect(staleFallbackWarning("2026-07-01T00:00:00.000Z", now)).toBeUndefined();
  });
});
