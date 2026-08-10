/**
 * [TEST]/[EDGE] Listen HOST/PORT resolution for local vs Docker Compose.
 */
import { describe, expect, it } from "vitest";
import { resolveListenConfig } from "../listen-config.ts";

describe("resolveListenConfig", () => {
  it("defaults to loopback :8787 for local pnpm start", () => {
    expect(resolveListenConfig({})).toEqual({
      port: 8787,
      hostname: "127.0.0.1",
    });
  });

  it("honors HOST=0.0.0.0 for Compose / multi-container reachability", () => {
    expect(resolveListenConfig({ HOST: "0.0.0.0", PORT: "8787" })).toEqual({
      port: 8787,
      hostname: "0.0.0.0",
    });
  });

  it("fails closed on invalid PORT", () => {
    expect(() => resolveListenConfig({ PORT: "0" })).toThrow(/PORT/);
    expect(() => resolveListenConfig({ PORT: "nope" })).toThrow(/PORT/);
  });

  it("fails closed on empty HOST", () => {
    expect(() => resolveListenConfig({ HOST: "   " })).toThrow(/HOST/);
  });
});
