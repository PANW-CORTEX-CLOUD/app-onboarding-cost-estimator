/**
 * Shared fail-closed meter-price lookup, consolidated from 6 identical
 * per-provider copies (ads/dspm/egress/streams/storage/registry-serverless).
 */
import { describe, expect, it } from "vitest";
import { requireRate } from "./require-rate.ts";

describe("requireRate", () => {
  it("returns the price when the meter is present", () => {
    expect(requireRate({ "s3-get-1k": 0.004 }, "s3-get-1k")).toBe(0.004);
  });

  it("returns a zero price as-is (0 is a valid price, not 'missing')", () => {
    expect(requireRate({ "free-tier-meter": 0 }, "free-tier-meter")).toBe(0);
  });

  it("fails closed instead of defaulting to $0 when the meter is absent", () => {
    expect(() => requireRate({}, "unknown-meter")).toThrow(
      /missing unit price for meter 'unknown-meter'/,
    );
  });
});
