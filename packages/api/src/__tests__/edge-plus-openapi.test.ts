/**
 * Package 25 — EDGE+ for API package 15.
 */
import { describe, expect, it } from "vitest";
import { API_VERSION, createApp } from "../app.ts";

describe("package 15 — EDGE+", () => {
  it("package 15 — EDGE+ API_VERSION is semver and matches OpenAPI info.version", async () => {
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    const app = createApp();
    const res = await app.request("/v1/openapi.yaml");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(
      new RegExp(`version:\\s*${API_VERSION.replace(/\./g, "\\.")}`),
    );
  });
});
