/**
 * Package 21 — share-state + compare delta unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  buildShareUrl,
  compareDelta,
  deserializeShareState,
  serializeShareState,
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

// Share-payload validation is covered exhaustively in
// share-state-validation.test.ts (allowlist semantics: bad fields are dropped
// and named via rejectedFields, not treated as a whole-payload rejection).
