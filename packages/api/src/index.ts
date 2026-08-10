/**
 * Hono API entry — OpenAPI REST + HTTP listen for local/dev/E2E (package 19).
 * Bind host via HOST (default 127.0.0.1; Docker Compose uses 0.0.0.0).
 */
import { serve } from "@hono/node-server";
import { app, createApp, API_VERSION } from "./app.ts";
import { resolveListenConfig } from "./listen-config.ts";
export { app, createApp, API_VERSION } from "./app.ts";
export { resolveListenConfig } from "./listen-config.ts";
export { problem } from "./problem.ts";
export {
  CreateEstimateRequestSchema,
  CreateProjectionRequestSchema,
  RefreshRatesRequestSchema,
  CloudProviderSchema,
} from "./schemas.ts";
export { createRateLimiter, refreshRatesLimiter } from "./rate-limit.ts";

export { app as default } from "./app.ts";

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") ||
    process.argv[1].endsWith("index.js") ||
    process.argv[1].includes("/api/src/index"));

if (isMain) {
  let listen;
  try {
    listen = resolveListenConfig(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  serve(
    { fetch: app.fetch, port: listen.port, hostname: listen.hostname },
    (info) => {
      console.log(
        `cloud-connector-api ${API_VERSION} listening on http://${listen.hostname}:${info.port}`,
      );
    },
  );
}
