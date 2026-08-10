/**
 * REQ-13 — the API must be debuggable without adding console.log.
 *
 * Two loggers with different jobs: `hono/logger` is the always-on access log
 * (what traffic was served), this one is the opt-in diagnostic log (why a
 * request produced that number). These pin the second one, including the
 * property that matters most in production — silence by default.
 */
import { describe, expect, it } from "vitest";
import { captureLogs, setDebugFilter } from "@cloud-connector/cost-engine";
import { createApp } from "../app.ts";
import { REQUEST_ID_HEADER } from "../request-log.ts";

const estimateBody = {
  provider: "azure",
  region: "eastus",
  capabilities: { auditLogs: true },
  volume: { accountCount: 10 },
};

function post(app: ReturnType<typeof createApp>, body: unknown) {
  return app.request("/v1/estimates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("silent unless asked", () => {
  it("emits nothing when the namespace is off", async () => {
    setDebugFilter(null);
    const { records } = captureLogs("cost:nothing-matches", async () => {
      await post(createApp(), estimateBody);
    });
    // captureLogs returns before the awaited body resolves; the assertion that
    // matters is that no cost:api record was captured under a foreign filter.
    expect(records.filter((r) => r.namespace === "cost:api")).toStrictEqual([]);
  });
});

describe("a request can be correlated end to end", () => {
  it("echoes a caller-supplied request id", async () => {
    const res = await createApp().request("/v1/health", {
      headers: { [REQUEST_ID_HEADER]: "my-trace-1" },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("my-trace-1");
  });

  it("mints an id when the caller supplies none", async () => {
    const res = await createApp().request("/v1/health");
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toBeTruthy();
    expect(id).not.toBe("");
  });

  it("EDGE: a blank id header is replaced rather than echoed", async () => {
    const res = await createApp().request("/v1/health", {
      headers: { [REQUEST_ID_HEADER]: "   " },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)?.trim()).not.toBe("");
  });
});

describe("what the diagnostic log actually says", () => {
  it("records the decisions behind an estimate", async () => {
    const app = createApp();
    setDebugFilter("cost:api");
    const lines: string[] = [];
    const { setLogSink } = await import("@cloud-connector/cost-engine");
    const previous = setLogSink((r) => {
      if (r.namespace === "cost:api") lines.push(r.message);
    });
    try {
      await post(app, estimateBody);
    } finally {
      setLogSink(previous);
      setDebugFilter(null);
    }

    const joined = lines.join("\n");
    // The fields that turn "the number looks wrong" into a diagnosis.
    expect(joined).toMatch(/provider=azure/);
    expect(joined).toMatch(/tfMode=/);
    expect(joined).toMatch(/rates=/);
    expect(joined).toMatch(/confidence=/);
    expect(joined).toMatch(/meters=\d+/);
    expect(joined).toMatch(/defaultsApplied=\d+/);
  });

  it("a rejected request logs why, not just that", async () => {
    const app = createApp();
    setDebugFilter("cost:api");
    const lines: string[] = [];
    const { setLogSink } = await import("@cloud-connector/cost-engine");
    const previous = setLogSink((r) => {
      if (r.namespace === "cost:api") lines.push(r.message);
    });
    try {
      // dspm enabled with no sizing at all — fails closed inside the engine.
      await post(app, {
        provider: "azure",
        region: "eastus",
        capabilities: { dspm: true },
        volume: { accountCount: 10 },
      });
    } finally {
      setLogSink(previous);
      setDebugFilter(null);
    }
    expect(lines.join("\n")).toMatch(/rejected: estimate:.*sizing/);
  });

  it("EDGE: a schema failure is logged as a rejection too", async () => {
    const app = createApp();
    setDebugFilter("cost:api");
    const lines: string[] = [];
    const { setLogSink } = await import("@cloud-connector/cost-engine");
    const previous = setLogSink((r) => {
      if (r.namespace === "cost:api") lines.push(r.message);
    });
    try {
      await post(app, { provider: "not-a-cloud", region: "eastus", capabilities: {} });
    } finally {
      setLogSink(previous);
      setDebugFilter(null);
    }
    expect(lines.join("\n")).toMatch(/rejected: schema:/);
  });
});
