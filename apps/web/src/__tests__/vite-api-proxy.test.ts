/**
 * [TEST]/[EDGE] Vite API proxy target — local default vs Compose DNS.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_PROXY_TARGET,
  resolveApiProxyTarget,
} from "../vite-api-proxy.ts";

describe("resolveApiProxyTarget", () => {
  it("defaults to loopback API when API_PROXY_TARGET unset", () => {
    expect(resolveApiProxyTarget({})).toBe(DEFAULT_API_PROXY_TARGET);
  });

  it("uses Compose service DNS when set", () => {
    expect(
      resolveApiProxyTarget({ API_PROXY_TARGET: "http://api:8787" }),
    ).toBe("http://api:8787");
  });

  it("strips trailing slash", () => {
    expect(
      resolveApiProxyTarget({ API_PROXY_TARGET: "http://api:8787/" }),
    ).toBe("http://api:8787");
  });

  it("fails closed on empty or invalid API_PROXY_TARGET", () => {
    expect(() =>
      resolveApiProxyTarget({ API_PROXY_TARGET: "" }),
    ).toThrow(/API_PROXY_TARGET/);
    expect(() =>
      resolveApiProxyTarget({ API_PROXY_TARGET: "   " }),
    ).toThrow(/API_PROXY_TARGET/);
    expect(() =>
      resolveApiProxyTarget({ API_PROXY_TARGET: "not-a-url" }),
    ).toThrow(/API_PROXY_TARGET/);
    expect(() =>
      resolveApiProxyTarget({ API_PROXY_TARGET: "ftp://api:8787" }),
    ).toThrow(/http/);
  });
});
